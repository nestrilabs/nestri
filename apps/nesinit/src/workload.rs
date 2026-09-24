// The one thing a descriptor turns into: mount what it names, run what it
// names, report how that ended.
//
// It is a trait because the two halves of it arrive at different times and
// because the interesting behaviour — one start and never a second, an exit
// reported rather than acted on — is behaviour of the caller, which a double
// can test without a VM, a share or a workload.

use std::ffi::CString;
use std::future::Future;
use std::io;
use std::pin::Pin;

use nesprotocol::lifecycle::{Exec, Exit, Mount, Overlay};

use std::os::unix::process::CommandExt;

use crate::reap::{Waiters, Watched};

/// Why something could not be done, in the words the operating system used.
///
/// The reason is passed through verbatim on purpose: `EACCES` and a path can
/// be acted on, where "could not start the workload" cannot.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Failure {
    pub reason: String,
}

impl Failure {
    pub fn new(reason: impl Into<String>) -> Self {
        Self {
            reason: reason.into(),
        }
    }
}

/// Resolves when the workload ends.
pub type Exited = Pin<Box<dyn Future<Output = io::Result<Exit>> + Send>>;

pub trait Workload {
    /// Make the shares the descriptor names, where it says to put them.
    fn mount(&mut self, mounts: &[Mount]) -> Result<(), Failure>;

    /// Stack each overlay the descriptor names: its build image, its writable
    /// layer, and the two together where it says.
    fn mount_overlays(&mut self, overlays: &[Overlay]) -> Result<(), Failure>;

    /// Start the command the descriptor names.
    ///
    /// Returning the exit as a future, rather than a `wait` method, is what
    /// keeps the caller free to read the channel while the workload runs — a
    /// stop has to arrive during the workload's life or it is not a stop.
    fn start(&mut self, exec: &Exec) -> Result<Exited, Failure>;

    /// Ask the workload to stop. Idempotent, and never ends the session by
    /// itself.
    fn signal_stop(&mut self);
}

/// The workload as a local process.
pub struct Process {
    waiters: Waiters,
    running: Option<Watched>,
}

impl Process {
    /// Started through the reaper's registry, because the reaper is the only
    /// thing in this component that may call `wait`.
    pub fn new(waiters: Waiters) -> Self {
        Self {
            waiters,
            running: None,
        }
    }

    /// Send a signal to the workload and nothing else.
    ///
    /// Nothing here ever signals the process group or every process: the order
    /// a shutdown promises is only true if the workload can be stopped alone.
    pub fn signal(&self, signal: libc::c_int) {
        let Some(watched) = &self.running else { return };
        // Nothing is signalled once the exit has been delivered. The pid was
        // freed by the reap that produced it, and the kernel is entitled to
        // give that number to something else — a stop or a kill aimed at it
        // then lands on a process nobody meant.
        if !watched.running() {
            return;
        }
        // SAFETY: two integers, and it cannot touch this process's memory. A
        // pid that has already gone fails with ESRCH, which is exactly the
        // idempotence the callers of this rely on.
        unsafe { libc::kill(watched.pid, signal) };
    }

    /// Wait up to `grace` for the workload to leave, without a runtime.
    ///
    /// Used on the way down, after the reaper has stopped: it polls for the
    /// one pid rather than for any child, so a slow service cannot be mistaken
    /// for the workload still running.
    pub fn await_exit(&self, grace: std::time::Duration) -> bool {
        let Some(watched) = &self.running else {
            return true;
        };
        if !watched.running() {
            return true; // already reaped, and its exit already reported
        }
        let pid = watched.pid;
        let deadline = std::time::Instant::now() + grace;
        loop {
            let mut status: libc::c_int = 0;
            // SAFETY: waitpid writes only into `status`.
            let seen = unsafe { libc::waitpid(pid, &mut status, libc::WNOHANG) };
            // -1 is ECHILD: already reaped, which is also gone.
            if seen == pid || seen == -1 {
                return true;
            }
            if std::time::Instant::now() >= deadline {
                return false;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    }
}

impl Workload for Process {
    fn mount(&mut self, mounts: &[Mount]) -> Result<(), Failure> {
        for share in mounts {
            // Stops at the first failure rather than mounting what it can: a
            // workload given some of its shares fails later, somewhere else,
            // for a reason nobody can see from here.
            mount_share(share)?;
        }
        Ok(())
    }

    fn mount_overlays(&mut self, overlays: &[Overlay]) -> Result<(), Failure> {
        for overlay in overlays {
            mount_overlay(overlay)?;
        }
        Ok(())
    }

    fn start(&mut self, exec: &Exec) -> Result<Exited, Failure> {
        let Some((program, args)) = exec.argv.split_first() else {
            return Err(Failure::new("the command is empty"));
        };

        // The standard library's process rather than the runtime's: the
        // runtime reaps the children it spawns, and in this component reaping
        // belongs to one place. See `reap::Waiters`.
        let mut command = std::process::Command::new(program);
        command.args(args);
        // Cleared rather than inherited: init's environment is the kernel's
        // and says nothing a workload should read.
        command.env_clear();
        if let Some(cwd) = &exec.cwd {
            command.current_dir(cwd);
        }

        let (uid, gid) = (exec.uid, exec.gid);

        // Made here, in the parent, because this process is the one with the
        // privilege to own it to somebody else -- and made before the spawn
        // rather than in `system::prepare`, because the uid it is named after
        // arrives with the launch and is not known at boot.
        //
        // A warning rather than a refusal: a workload that draws nothing needs
        // no runtime directory, and refusing the launch would turn "audio has
        // nowhere to put a socket" into "the box does not start".
        let runtime = match crate::system::runtime_dir(uid, gid) {
            Ok(path) => {
                tracing::info!(%path, uid, "the launch has a runtime directory");
                Some(path)
            }
            Err(error) => {
                tracing::warn!(
                    uid,
                    "no runtime directory for this launch, so anything reading \
                     XDG_RUNTIME_DIR fails on it: {error}"
                );
                None
            }
        };
        command.envs(environment(exec, runtime.as_deref()));

        // SAFETY: the closure runs between fork and exec in the child, where
        // only async-signal-safe calls are allowed. These two are, and it
        // allocates nothing.
        unsafe {
            command.pre_exec(move || {
                // gid first: dropping the uid first would lose the privilege
                // needed to set the gid at all.
                if libc::setgid(gid) != 0 {
                    return Err(io::Error::last_os_error());
                }
                if libc::setuid(uid) != 0 {
                    return Err(io::Error::last_os_error());
                }
                Ok(())
            });
        }

        let mut watched = self
            .waiters
            .watch(|| Ok(command.spawn()?.id() as i32))
            .map_err(|error| {
                // The program, the user, and what the system said.
                //
                // `Permission denied` on its own is the least useful true
                // sentence available here: it is equally consistent with a
                // share the caller exported without letting this user read it,
                // a binary that is not executable, and a mount that forbids
                // execution. The one thing a reader needs is which file, and
                // as whom. Measured 2026-09-12: a launch refused with the bare
                // message cost a search of three machines' permissions.
                Failure::new(format!("{program} as {}:{}: {error}", exec.uid, exec.gid))
            })?;

        // The caller gets the exit and reports it; this handle keeps the pid
        // and whether that pid is still this child's.
        let exit = watched.take_exit().expect("a new watch has its exit");
        self.running = Some(watched);

        Ok(Box::pin(async move {
            exit.await
                .map_err(|_| io::Error::other("the workload's exit was not delivered"))
        }))
    }

    fn signal_stop(&mut self) {
        self.signal(libc::SIGTERM);
    }
}

/// Everything a launch is started with, in the order that decides ties.
///
/// The image's own graphics settings first and the caller's environment last,
/// so a host can override anything here. A host that knows better than this
/// image about this box is unlikely, but it should not have to patch an image
/// to say so.
///
/// A function rather than two calls on the command, because the two calls
/// could be -- and for one commit were -- reduced to one by an edit that
/// dropped the first. The only thing that noticed was a dead-code warning.
///
/// `runtime` is the directory made for this launch's user, or `None` when it
/// could not be made. **Making it and not naming it is the same as not making
/// it**: the environment is cleared, so nothing a workload inherits points at
/// it, and every toolkit that wants one reads `XDG_RUNTIME_DIR`. A client that
/// finds the variable unset does not fail loudly -- the compositor here falls
/// back to `/tmp` -- so the sockets land somewhere world-writable and shared
/// with every other user, and everything reports success. ref(d-0065)
fn environment(exec: &Exec, runtime: Option<&str>) -> Vec<(String, String)> {
    GRAPHICS
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .chain(runtime.map(|path| ("XDG_RUNTIME_DIR".to_string(), path.to_string())))
        .chain(exec.env.iter().map(|(k, v)| (k.clone(), v.clone())))
        .collect()
}

/// What the image's own graphics stack needs said out loud.
///
/// # Why this is here and not in a profile script
///
/// There is one in the image, and it has never run: every process in a box is
/// exec'd by this component with `env_clear`, and nothing starts a login
/// shell. A `profile.d` file is for a person who logged in, and nobody does.
///
/// # Why it has to be said at all
///
/// The image ships a Mesa with exactly one gallium driver, `zink`, on purpose:
/// OpenGL is translated to Vulkan so that the capture layer -- which is a
/// Vulkan layer -- sees the frames of a game that draws in GL. A game whose GL
/// reached a native driver would render correctly and be captured as nothing,
/// which is the worst shape a failure can have here.
///
/// But the loader picks a driver by the *kernel device's* name. It looks for
/// one called `virtio_gpu`, finds that the only driver built is `zink`, and
/// gives up with `virtio_gpu: driver missing`. It does not fall back, and
/// `zink` is never chosen for an arbitrary device on its own. So it is named.
///
/// Measured 2026-09-12: without these, every process that touched the GPU
/// failed to create an EGL screen, in a box whose Vulkan drivers were both
/// present and loadable.
const GRAPHICS: &[(&str, &str)] = &[
    ("MESA_LOADER_DRIVER_OVERRIDE", "zink"),
    ("GALLIUM_DRIVER", "zink"),
    // For anything that goes through libglvnd. Harmless where nothing does.
    ("__GLX_VENDOR_LIBRARY_NAME", "mesa"),
    // **Intel's Vulkan Video is off unless asked for.** Its driver gates the
    // video encode and decode extensions behind this, so on an Intel host the
    // capture layer finds no encode support, produces nothing, and says
    // nothing about why -- a box that streams a black screen while every
    // component reports success.
    //
    // Read only by Intel's driver, so it costs nothing on a host with any
    // other GPU. Measured 2026-09-12 on an Arc A310: without it, capture
    // produced no output at all.
    ("ANV_DEBUG", "video-encode,video-decode"),
    // **Audio is not under this user's runtime directory.** The services that
    // serve it run as somebody else, so the socket lives somewhere both can
    // reach and both are told where. Without this a game renders and plays
    // silently, having looked under its own uid and found nothing.
    ("PIPEWIRE_RUNTIME_DIR", crate::services::AUDIO_DIR),
    // The same, for a client that speaks PulseAudio instead. It does not read
    // the variable above, and its default is under its own runtime directory.
    ("PULSE_SERVER", crate::services::PULSE_SERVER),
];

/// Mount one share where the descriptor says to put it.
///
/// The tag names an export; nothing here is a path on the other side of the
/// channel, so the guest still learns nothing about the filesystem it is being
/// handed a piece of.
fn mount_share(share: &Mount) -> Result<(), Failure> {
    // Checked before anything is created: a descriptor this component cannot
    // act on should leave no directory behind to confuse whoever reads the
    // failure.
    let (source, target, flags) = options(share)?;

    // The mount point may not exist yet: a share can land anywhere the
    // descriptor names, including a directory no image created.
    std::fs::create_dir_all(&share.at).map_err(|error| failed(share, error))?;

    // SAFETY: mount takes two paths, a filesystem name and a flag word, all
    // of which outlive the call, and no options string.
    let mounted = unsafe {
        libc::mount(
            source.as_ptr(),
            target.as_ptr(),
            FSTYPE.as_ptr(),
            flags,
            std::ptr::null(),
        )
    };
    if mounted != 0 {
        return Err(failed(share, io::Error::last_os_error()));
    }
    Ok(())
}

/// The shares arrive over a virtio transport, which is the only kind of
/// filesystem this mounts. A descriptor cannot name another.
const FSTYPE: &std::ffi::CStr = c"virtiofs";

/// Stack one overlay: the build image, the box's writable layer, and the two
/// together at `at`.
///
/// Each step's failure names the step, because "the install did not mount"
/// has three different causes and each one is fixed somewhere else: a build
/// image the kernel cannot read, an upper layer that was never formatted, and
/// an overlay the kernel refused.
fn mount_overlay(overlay: &Overlay) -> Result<(), Failure> {
    // Everything that can be refused without touching the filesystem is
    // refused first, so a descriptor this cannot act on leaves nothing behind.
    let plan = OverlayPlan::new(overlay)?;

    mount_one(&plan.lower, &plan.lower_at, c"erofs", plan.lower_flags, None)
        .map_err(|error| plan.failed("the build image", &plan.lower_at, error))?;
    mount_one(&plan.upper, &plan.rw_at, c"ext4", plan.upper_flags, None)
        .map_err(|error| plan.failed("the writable layer", &plan.rw_at, error))?;

    for dir in [&plan.upper_dir, &plan.work_dir] {
        std::fs::create_dir_all(as_path(dir))
            .map_err(|error| plan.failed("the writable layer", dir, error))?;
    }
    // **The upper directory takes the build's root ownership.** overlayfs
    // shows a merged directory with the attributes of its upper half when it
    // has one, and this one always does -- so an upper directory this init
    // created, `root:root 0755`, would make the install's top directory
    // unwritable to the workload, whatever the build image says. Copied from
    // the lower root rather than named here: which uid the workload runs as is
    // the host's decision, and the host already made it when it packed the
    // image.
    let (uid, gid, mode) = ownership(&plan.lower_at)
        .map_err(|error| plan.failed("the build image", &plan.lower_at, error))?;
    set_ownership(&plan.upper_dir, uid, gid, mode)
        .map_err(|error| plan.failed("the writable layer", &plan.upper_dir, error))?;

    mount_one(
        c"overlay",
        &plan.at,
        c"overlay",
        plan.overlay_flags,
        Some(&plan.overlay_data),
    )
    .map_err(|error| plan.failed("the overlay", &plan.at, error))?;
    Ok(())
}

/// Mount one filesystem, creating its mount point first.
fn mount_one(
    source: &std::ffi::CStr,
    target: &std::ffi::CStr,
    fstype: &std::ffi::CStr,
    flags: libc::c_ulong,
    data: Option<&std::ffi::CStr>,
) -> io::Result<()> {
    // The mount point may not exist yet: the descriptor can name anywhere,
    // including a directory no image created.
    std::fs::create_dir_all(as_path(target))?;
    // SAFETY: every pointer is to a nul-terminated string that outlives the
    // call, and a null data pointer is what mount(2) takes for "no options".
    let mounted = unsafe {
        libc::mount(
            source.as_ptr(),
            target.as_ptr(),
            fstype.as_ptr(),
            flags,
            data.map_or(std::ptr::null(), |d| d.as_ptr().cast()),
        )
    };
    if mounted != 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

/// The same bytes, as a path: lossless, where a round trip through `str` is
/// not.
fn as_path(path: &std::ffi::CStr) -> &std::path::Path {
    use std::os::unix::ffi::OsStrExt;
    std::path::Path::new(std::ffi::OsStr::from_bytes(path.to_bytes()))
}

fn ownership(path: &std::ffi::CStr) -> io::Result<(u32, u32, u32)> {
    use std::os::unix::fs::MetadataExt;
    let meta = std::fs::metadata(as_path(path))?;
    Ok((meta.uid(), meta.gid(), meta.mode() & 0o7777))
}

fn set_ownership(path: &std::ffi::CStr, uid: u32, gid: u32, mode: u32) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let path = as_path(path);
    std::os::unix::fs::chown(path, Some(uid), Some(gid))?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode))
}

/// What the mount call is given, split out because this is the part worth
/// asserting: mounting itself needs privileges a test does not have.
fn options(share: &Mount) -> Result<(CString, CString, libc::c_ulong), Failure> {
    // nosuid and nodev on every share, whether or not it is writable. A share
    // is data handed to the guest; a setuid binary or a device node appearing
    // in one is not something a workload should be able to use, and no
    // descriptor has a way to ask for it.
    let mut flags = libc::MS_NOSUID | libc::MS_NODEV;
    if share.ro {
        flags |= libc::MS_RDONLY;
    }
    // A nul byte inside a tag or a path is a descriptor that cannot be carried
    // out under any flags. Refused by name rather than silently emptied: an
    // empty source turns up later as a mount failure about something else
    // entirely, which is the wrong thing to go and look at.
    let source = CString::new(share.tag.as_str()).map_err(|_| {
        Failure::new(format!(
            "the share tag contains a nul byte: {:?}",
            share.tag
        ))
    })?;
    let target = CString::new(share.at.as_str()).map_err(|_| {
        Failure::new(format!(
            "the mount point contains a nul byte: {:?}",
            share.at
        ))
    })?;
    Ok((source, target, flags))
}

/// Everything an overlay's three mounts are given, worked out before any of
/// them is attempted.
///
/// Split out because this is the part worth asserting: mounting needs
/// privileges a test does not have.
///
/// # Where the layers go
///
/// Beside the overlay, in a hidden directory named after it:
/// `/nestri/install` stacks `/nestri/.install/lower` under
/// `/nestri/.install/rw/upper`. Beside rather than under, because anything
/// mounted under `at` is covered the moment the overlay is mounted over it.
///
/// # Flags
///
/// `nosuid` and `nodev` on every layer and on the result, for the reason every
/// share has them: what is stacked here is files a CDN handed us, checked for
/// the bytes the manifest named and for nothing about what those bytes are.
/// **Not `noexec`** anywhere: the game's executable is in the build.
///
/// `noatime` on the writable layer and the overlay, so a game reading its own
/// install does not turn every read into a write. The build image is mounted
/// read-only and has no access times to write.
///
/// No filesystem-specific options on the upper layer: `commit=` and
/// `barrier=` were once passed to a journal-less ext4 and the mount failed
/// outright with `EINVAL`.
#[derive(Debug)]
struct OverlayPlan {
    lower: CString,
    upper: CString,
    at: CString,
    lower_at: CString,
    rw_at: CString,
    upper_dir: CString,
    work_dir: CString,
    lower_flags: libc::c_ulong,
    upper_flags: libc::c_ulong,
    overlay_flags: libc::c_ulong,
    overlay_data: CString,
}

impl OverlayPlan {
    fn new(overlay: &Overlay) -> Result<Self, Failure> {
        let at = std::path::Path::new(&overlay.at);
        let (Some(parent), Some(name)) = (at.parent(), at.file_name()) else {
            return Err(Failure::new(format!(
                "the overlay mount point has no parent to put its layers beside: {:?}",
                overlay.at
            )));
        };
        let layers = parent.join(format!(".{}", name.to_string_lossy()));
        let lower_at = layers.join("lower");
        let rw_at = layers.join("rw");
        let upper_dir = rw_at.join("upper");
        let work_dir = rw_at.join("work");

        // overlayfs splits its options on commas and its layer lists on
        // colons, and has no escape for either that this should rely on. A
        // path carrying one would mount a different directory than the one
        // named, so it is refused.
        for path in [&lower_at, &upper_dir, &work_dir] {
            let text = path.to_string_lossy();
            if text.contains([',', ':']) {
                return Err(Failure::new(format!(
                    "the overlay mount point cannot carry a comma or a colon: {:?}",
                    overlay.at
                )));
            }
        }
        let data = format!(
            "lowerdir={},upperdir={},workdir={}",
            lower_at.display(),
            upper_dir.display(),
            work_dir.display()
        );

        let common = libc::MS_NOSUID | libc::MS_NODEV;
        Ok(Self {
            lower: c_string(&overlay.lower, "the build image device")?,
            upper: c_string(&overlay.upper, "the writable layer device")?,
            at: c_string(&overlay.at, "the overlay mount point")?,
            lower_at: c_string(&lower_at.to_string_lossy(), "the overlay mount point")?,
            rw_at: c_string(&rw_at.to_string_lossy(), "the overlay mount point")?,
            upper_dir: c_string(&upper_dir.to_string_lossy(), "the overlay mount point")?,
            work_dir: c_string(&work_dir.to_string_lossy(), "the overlay mount point")?,
            lower_flags: common | libc::MS_RDONLY,
            upper_flags: common | libc::MS_NOATIME,
            overlay_flags: common | libc::MS_NOATIME,
            overlay_data: c_string(&data, "the overlay mount point")?,
        })
    }

    /// Which step failed, on which path, in the operating system's words.
    fn failed(&self, step: &str, path: &std::ffi::CStr, error: io::Error) -> Failure {
        Failure::new(format!(
            "{}: {step}: {}: {error}",
            self.at.to_string_lossy(),
            path.to_string_lossy()
        ))
    }
}

/// A nul byte inside a path is a descriptor that cannot be carried out under
/// any flags. Refused by name rather than silently emptied: an empty path turns
/// up later as a mount failure about something else entirely.
fn c_string(text: &str, what: &str) -> Result<CString, Failure> {
    CString::new(text).map_err(|_| Failure::new(format!("{what} contains a nul byte: {text:?}")))
}

/// A failure names the path, which is what makes it actionable: a permission
/// error and the directory it happened on can be acted on, where "the share
/// did not mount" cannot.
fn failed(share: &Mount, error: io::Error) -> Failure {
    Failure::new(format!("{}: {error}", share.at))
}


#[cfg(test)]
mod tests {
    use super::*;

    /// The driver override has to reach the workload, because nothing else
    /// carries it: the image's profile script never runs for an exec'd
    /// process. Without it a game's OpenGL finds no driver at all.
    fn exec_with(env: &[(&str, &str)]) -> Exec {
        Exec {
            argv: vec!["/bin/true".into()],
            env: env
                .iter()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect(),
            cwd: None,
            uid: 1001,
            gid: 1001,
        }
    }

    /// The override has to reach the launch, and asserting that it is in a
    /// table is not asserting that. A commit once defined the table and never
    /// applied it; the tests passed and a dead-code warning was the only sign.
    #[test]
    fn the_launch_is_told_which_gallium_driver_to_use() {
        let env = environment(&exec_with(&[]), None);
        let driver = env
            .iter()
            .find(|(k, _)| k == "MESA_LOADER_DRIVER_OVERRIDE")
            .map(|(_, v)| v.as_str());
        assert_eq!(
            driver,
            Some("zink"),
            "without this a game's GL reaches a native driver, renders \
             correctly, and is captured as nothing"
        );
    }

    /// Intel's driver hides Vulkan Video behind a debug variable, and the
    /// capture layer needs video encode.
    ///
    /// Without it the layer loads, finds no encode support, produces nothing,
    /// and reports nothing -- so the box streams a black screen while every
    /// component says it is working. It cost an evening to find once.
    #[test]
    fn intels_vulkan_video_is_asked_for() {
        let env = environment(&exec_with(&[]), None);
        let debug = env
            .iter()
            .find(|(k, _)| k == "ANV_DEBUG")
            .map(|(_, v)| v.as_str())
            .unwrap_or_default();
        assert!(
            debug.contains("video-encode"),
            "on an Intel host this is the difference between a stream and a \
             black screen, and neither says which: {debug:?}"
        );
    }

    /// The directory made for the launch has to be named to the launch.
    ///
    /// Making it and saying nothing is indistinguishable from not making it:
    /// the environment is cleared, so a workload inherits no path to it. The
    /// compositor in this image falls back to `/tmp` rather than failing, which
    /// means the whole session comes up, works, and puts one user's sockets in
    /// a directory every other user can write. ref(d-0065)
    #[test]
    fn the_launch_is_told_where_its_runtime_directory_is() {
        let env = environment(&exec_with(&[]), Some("/run/user/1001"));
        let runtime = env
            .iter()
            .find(|(k, _)| k == "XDG_RUNTIME_DIR")
            .map(|(_, v)| v.as_str());
        assert_eq!(runtime, Some("/run/user/1001"));
    }

    /// A directory that could not be made is not claimed to exist.
    ///
    /// Pointing a workload at a path that is not there is worse than leaving it
    /// unset: unset is a case every toolkit handles, and a bad path is one they
    /// report as something else.
    #[test]
    fn a_launch_without_a_runtime_directory_is_told_nothing() {
        let env = environment(&exec_with(&[]), None);
        assert!(!env.iter().any(|(k, _)| k == "XDG_RUNTIME_DIR"));
    }

    /// Last wins, so a host can override what the image assumes.
    #[test]
    fn the_callers_own_environment_beats_the_images() {
        let env = environment(&exec_with(&[("GALLIUM_DRIVER", "something-else")]), None);
        let chosen: Vec<&str> = env
            .iter()
            .filter(|(k, _)| k == "GALLIUM_DRIVER")
            .map(|(_, v)| v.as_str())
            .collect();
        // Both are present; `envs` applies in order, so the last is the one
        // the process gets.
        assert_eq!(chosen.last(), Some(&"something-else"));
    }

    fn share(ro: bool) -> Mount {
        Mount {
            tag: "user".into(),
            at: "/mnt/user".into(),
            ro,
        }
    }

    #[test]
    fn a_writable_share_is_still_mounted_without_devices_or_setuid() {
        let (source, target, flags) = options(&share(false)).unwrap();
        assert_eq!(
            source.to_str().unwrap(),
            "user",
            "the tag is the source, never a path"
        );
        assert_eq!(target.to_str().unwrap(), "/mnt/user");
        assert_eq!(flags & libc::MS_NOSUID, libc::MS_NOSUID);
        assert_eq!(flags & libc::MS_NODEV, libc::MS_NODEV);
        assert_eq!(flags & libc::MS_RDONLY, 0);
    }

    fn overlay(at: &str) -> Overlay {
        Overlay {
            lower: "/dev/vdb".into(),
            upper: "/dev/vdc".into(),
            at: at.into(),
        }
    }

    /// The layers sit beside the overlay, never under it: anything mounted
    /// under `at` is hidden the moment the overlay covers it.
    #[test]
    fn an_overlays_layers_sit_beside_it_and_the_options_name_them() {
        let plan = OverlayPlan::new(&overlay("/nestri/install")).unwrap();
        assert_eq!(plan.lower.to_str().unwrap(), "/dev/vdb");
        assert_eq!(plan.upper.to_str().unwrap(), "/dev/vdc");
        assert_eq!(plan.lower_at.to_str().unwrap(), "/nestri/.install/lower");
        assert_eq!(plan.rw_at.to_str().unwrap(), "/nestri/.install/rw");
        assert_eq!(
            plan.overlay_data.to_str().unwrap(),
            "lowerdir=/nestri/.install/lower,\
             upperdir=/nestri/.install/rw/upper,\
             workdir=/nestri/.install/rw/work"
        );
    }

    /// Every layer carries the guard every share carries, and none of them
    /// stops the game's own executable from running.
    ///
    /// These are the mounts that most need it: a share is a directory this
    /// host prepared, and a build is a filesystem made out of whatever a CDN
    /// sent.
    #[test]
    fn every_layer_is_mounted_without_devices_or_setuid_but_can_still_execute() {
        let plan = OverlayPlan::new(&overlay("/nestri/install")).unwrap();
        for flags in [plan.lower_flags, plan.upper_flags, plan.overlay_flags] {
            assert_eq!(flags & libc::MS_NOSUID, libc::MS_NOSUID);
            assert_eq!(flags & libc::MS_NODEV, libc::MS_NODEV);
            assert_eq!(flags & libc::MS_NOEXEC, 0);
        }
        assert_eq!(plan.lower_flags & libc::MS_RDONLY, libc::MS_RDONLY);
        assert_eq!(plan.upper_flags & libc::MS_RDONLY, 0);
        assert_eq!(plan.overlay_flags & libc::MS_RDONLY, 0);
        assert_eq!(plan.overlay_flags & libc::MS_NOATIME, libc::MS_NOATIME);
    }

    /// overlayfs splits its options on commas and colons, so a path carrying
    /// one would stack a different directory than the one named.
    #[test]
    fn an_overlay_the_kernel_would_misread_is_refused_before_anything_mounts() {
        for at in ["/nestri/in,stall", "/nestri/in:stall", "/", "/nestri/ins\0tall"] {
            assert!(OverlayPlan::new(&overlay(at)).is_err(), "{at:?} was accepted");
        }
    }

    #[test]
    fn a_failed_overlay_step_names_the_overlay_the_step_and_the_path() {
        let plan = OverlayPlan::new(&overlay("/nestri/install")).unwrap();
        let failure = plan.failed(
            "the build image",
            &plan.lower_at,
            io::Error::from_raw_os_error(libc::ENODEV),
        );
        assert!(
            failure
                .reason
                .starts_with("/nestri/install: the build image: /nestri/.install/lower: "),
            "{}",
            failure.reason
        );
    }

    #[test]
    fn a_read_only_share_is_mounted_read_only() {
        let (_, _, flags) = options(&share(true)).unwrap();
        assert_eq!(flags & libc::MS_RDONLY, libc::MS_RDONLY);
    }

    #[test]
    fn a_descriptor_with_a_nul_byte_in_it_is_refused_by_name() {
        let tagged = Mount {
            tag: "us\0er".into(),
            at: "/mnt/user".into(),
            ro: false,
        };
        let failure = options(&tagged).expect_err("an empty source would have been mounted");
        assert!(failure.reason.contains("tag"), "{}", failure.reason);

        let placed = Mount {
            tag: "user".into(),
            at: "/mnt/us\0er".into(),
            ro: false,
        };
        let failure = options(&placed).expect_err("an empty target would have been mounted");
        assert!(failure.reason.contains("mount point"), "{}", failure.reason);
    }

    #[test]
    fn a_failure_names_the_path_it_happened_on() {
        let failure = failed(&share(false), io::Error::from_raw_os_error(libc::EACCES));
        assert!(
            failure.reason.starts_with("/mnt/user: "),
            "{}",
            failure.reason
        );
        assert!(
            failure.reason.contains("ermission denied"),
            "{}",
            failure.reason
        );
    }
}

#[cfg(test)]
pub mod double {
    use super::*;
    use tokio::sync::oneshot;

    /// A workload that starts nothing, so what the caller does with it is the
    /// only thing under test.
    pub struct Double {
        pub mounted: Vec<Vec<Mount>>,
        pub overlays: Vec<Vec<Overlay>>,
        pub started: Vec<Exec>,
        pub stops: usize,
        pub mount_failure: Option<Failure>,
        pub start_failure: Option<Failure>,
        exit: Exit,
        on_stop: Option<oneshot::Sender<Exit>>,
        holds_until_stopped: bool,
    }

    impl Double {
        /// Its workload has already ended by the time it is started.
        pub fn exits_at_once(exit: Exit) -> Self {
            Self::new(exit, false)
        }

        /// Its workload runs until it is asked to stop.
        pub fn exits_when_stopped(exit: Exit) -> Self {
            Self::new(exit, true)
        }

        fn new(exit: Exit, holds_until_stopped: bool) -> Self {
            Self {
                mounted: Vec::new(),
                overlays: Vec::new(),
                started: Vec::new(),
                stops: 0,
                mount_failure: None,
                start_failure: None,
                exit,
                on_stop: None,
                holds_until_stopped,
            }
        }
    }

    impl Workload for Double {
        fn mount(&mut self, mounts: &[Mount]) -> Result<(), Failure> {
            self.mounted.push(mounts.to_vec());
            match &self.mount_failure {
                Some(failure) => Err(failure.clone()),
                None => Ok(()),
            }
        }

        fn mount_overlays(&mut self, overlays: &[Overlay]) -> Result<(), Failure> {
            self.overlays.push(overlays.to_vec());
            match &self.mount_failure {
                Some(failure) => Err(failure.clone()),
                None => Ok(()),
            }
        }

        fn start(&mut self, exec: &Exec) -> Result<Exited, Failure> {
            self.started.push(exec.clone());
            if let Some(failure) = &self.start_failure {
                return Err(failure.clone());
            }
            let exit = self.exit;
            if !self.holds_until_stopped {
                return Ok(Box::pin(async move { Ok(exit) }));
            }
            let (tx, rx) = oneshot::channel();
            self.on_stop = Some(tx);
            Ok(Box::pin(async move {
                rx.await
                    .map_err(|_| io::Error::other("the workload was dropped"))
            }))
        }

        fn signal_stop(&mut self) {
            self.stops += 1;
            if let Some(tx) = self.on_stop.take() {
                let _ = tx.send(self.exit);
            }
        }
    }
}
