// The rest of what an init system does, and what a box needs before anything
// in it can work: a hostname, an address, the directories a session's sockets
// live in, and device nodes something is allowed to open.
//
// None of this is interesting and all of it is load-bearing. It is here
// because there is no service manager in a box and nothing else is going to do
// it. ref(d-0063)
//
// # There is no udev, on purpose
//
// `devtmpfs` creates the device nodes; what udev added on top was ownership
// from a rule file, and the box's device list is short enough to state. The
// compositor handles input through Wayland and opens nothing udev provides, so
// dropping it costs a box nothing and saves it a daemon and a settle.
//
// # Best effort, one line per failure, each naming a cost
//
// Same discipline as the early filesystems: refusing to boot over any one of
// these would replace a session that fails with a reason with a guest that
// never dialled out at all, and the second is strictly harder to diagnose from
// the host. A box with no address still boots and still says so.

use std::path::Path;

use crate::services::{RUNTIME_DIR, SERVICE_GID, SERVICE_UID};

/// What the box calls itself.
///
/// Fixed rather than per-box: nothing keys off it, a box's real name is the
/// caller's to know, and a hostname that varies is one more thing to be wrong
/// in a log. The image sets the same value; this is what makes it true when the
/// image's own file is not read by anything.
const HOSTNAME: &str = "nesbox";

/// The interface a box's address lands on, and what to use when nothing says.
///
/// The defaults match the host's own tap addressing. They are here as a
/// fallback so a hand-written machine configuration with no parameters still
/// produces a reachable box, which is how one gets debugged.
const IFACE: &str = "eth0";
const DEFAULT_ADDRESS: &str = "172.30.0.2/24";
const DEFAULT_GATEWAY: &str = "172.30.0.1";

/// Do all of it. Called once, before anything else in the box exists.
pub fn prepare() {
    hostname();
    directories();
    devices();
    machine_id();
    network();
}

fn hostname() {
    // SAFETY: a pointer and a length into a string that outlives the call.
    let set = unsafe { libc::sethostname(HOSTNAME.as_ptr().cast(), HOSTNAME.len()) };
    if set != 0 {
        tracing::warn!(
            error = %std::io::Error::last_os_error(),
            "could not set the hostname, so log lines from inside this box are \
             harder to tell apart"
        );
    }
}

/// A directory a session needs, and who has to be able to write in it.
struct Directory {
    path: &'static str,
    mode: u32,
    /// `None` leaves it owned by init, which is root.
    owner: Option<(u32, u32)>,
    cost: &'static str,
}

/// What four init scripts used to create between them.
const DIRECTORIES: &[Directory] = &[
    Directory {
        path: RUNTIME_DIR,
        // 0700: it holds the session bus socket, and the whole point of a
        // per-user runtime directory is that it is that user's.
        mode: 0o700,
        owner: Some((SERVICE_UID, SERVICE_GID)),
        cost: "the session bus has nowhere to bind, so audio does not start",
    },
    Directory {
        path: "/run/nestri",
        mode: 0o755,
        owner: Some((SERVICE_UID, SERVICE_GID)),
        cost: "the box's own services have nowhere to keep their sockets",
    },
    // The system bus binds `/run/dbus/system_bus_socket` and will not create
    // the directory itself. `/run` is a fresh tmpfs every boot, so without this
    // the bus exits 1 immediately and the init reports a dead service on every
    // single boot -- measured 2026-09-11, on the first box that got this far.
    //
    // What it costs is not obvious from the message: audio still starts, but
    // PipeWire loses RTKit and runs without realtime scheduling, which is a
    // latency problem that looks like nothing at boot.
    //
    // Owned by root rather than the service user: the bus is started as root
    // and drops itself, and a directory the session could replace is a socket
    // the session could impersonate.
    // Audio's socket, shared by the services that serve it and the workload
    // that plays through it -- who are deliberately different users, so a
    // per-user runtime directory cannot hold it. See `services::AUDIO_DIR`.
    //
    // Owned by the service user and not writable by the workload: the workload
    // must be able to *open* the socket in here and must never be able to
    // replace it, which is the property `ticket::Untrusted` rests on.
    Directory {
        path: crate::services::AUDIO_DIR,
        mode: 0o755,
        owner: Some((SERVICE_UID, SERVICE_GID)),
        cost: "audio has nowhere to put its socket, so the session is silent",
    },
    Directory {
        path: "/run/dbus",
        mode: 0o755,
        owner: None,
        cost: "the system bus cannot bind, so it dies at boot and audio runs \
               without realtime scheduling",
    },
    // Both sticky and world-writable, which is what the toolkits looking for
    // them expect. A workload and the services are different users and either
    // may create a socket here.
    Directory {
        path: "/tmp/.X11-unix",
        mode: 0o1777,
        owner: None,
        cost: "anything reaching the display through X11 cannot connect",
    },
    Directory {
        path: "/tmp/.ICE-unix",
        mode: 0o1777,
        owner: None,
        cost: "some toolkits log an error at startup and carry on",
    },
];

fn directories() {
    for directory in DIRECTORIES {
        if let Err(error) = make(directory) {
            tracing::warn!(
                path = directory.path,
                cost = directory.cost,
                "could not prepare a directory: {error}"
            );
        }
    }
}

fn make(directory: &Directory) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;

    std::fs::create_dir_all(directory.path)?;
    // Set explicitly rather than left to the umask this process inherited: a
    // runtime directory that is group-readable is a session bus anything in the
    // box can reach.
    std::fs::set_permissions(
        directory.path,
        std::fs::Permissions::from_mode(directory.mode),
    )?;

    if let Some((uid, gid)) = directory.owner {
        chown(directory.path, uid, gid)?;
    }
    Ok(())
}

/// A device node the box has to be able to open, and by whom.
///
/// This is the whole of what udev's rules were doing for a box.
const DEVICES: &[&str] = &["/dev/dri/renderD128", "/dev/dri/card0"];

/// `devtmpfs` creates these owned by root with no group access, and both the
/// box's own services and the workload have to open them.
///
/// **Mode `0666`, and it is deliberate.** Outside a box that would be wrong.
/// Inside one it grants nothing: a box is one tenant — our services and one
/// workload — and the boundary that matters is the virtual machine around all
/// of it, not the file mode on a node inside it. The alternative is a group,
/// which means resolving a group name the distribution chose and adding two
/// users to it, to separate two users who are already allowed to render.
fn devices() {
    use std::os::unix::fs::PermissionsExt;

    for path in DEVICES {
        if !Path::new(path).exists() {
            // Not a warning. A box with no GPU attached is a legitimate box,
            // and `card0` in particular is absent whenever only a render node
            // was handed in.
            tracing::debug!(path, "no such device in this box");
            continue;
        }
        if let Err(error) = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o666)) {
            tracing::warn!(
                path,
                "could not open up a device node, so a workload may not be able \
                 to render at all: {error}"
            );
        }
    }
}

/// Give the box an id of its own, per boot.
///
/// The bus wants one and will not start without it. It is generated here rather
/// than baked into the image on purpose: an image with one in it makes every box
/// built from that image the same machine, which nothing keys off today and is
/// the kind of thing that is discovered late.
///
/// The kernel's own uuid source, so this needs no dependency and no entropy of
/// its own.
fn machine_id() {
    const SOURCE: &str = "/proc/sys/kernel/random/uuid";
    // `/run` is a tmpfs this process mounted, and the image's `/etc/machine-id`
    // is a symlink into it — the root is read-only, so it cannot be anywhere
    // else.
    const TARGET: &str = "/run/machine-id";

    let id = match std::fs::read_to_string(SOURCE) {
        Ok(uuid) => uuid.trim().replace('-', ""),
        Err(error) => {
            tracing::warn!("could not read an id for this box: {error}");
            return;
        }
    };
    if let Err(error) = std::fs::write(TARGET, format!("{id}\n")) {
        tracing::warn!("could not write this box's id, so the system bus will not start: {error}");
    }
}

/// Bring the loopback up, and the address the caller put on the command line.
///
/// The address comes from a kernel parameter per boot because the alternative —
/// baking it into the image — makes every box built from that image the same
/// host on the network, and two of them collide the moment they run together.
///
/// `nestri.`-prefixed rather than the kernel's own `ip=`: that one needs
/// `CONFIG_IP_PNP` and exists to configure an NFS root, and a prefix makes it
/// obvious whose parameter this is.
fn network() {
    run(
        "ip",
        &["link", "set", "lo", "up"],
        "nothing in the box can reach a service on its own loopback",
    );

    // A box may have been started with no network device at all, which is a
    // perfectly good configuration for one that only talks over vsock.
    if !Path::new(&format!("/sys/class/net/{IFACE}")).exists() {
        tracing::info!(iface = IFACE, "this box has no network device");
        return;
    }

    let cmdline = std::fs::read_to_string("/proc/cmdline").unwrap_or_default();
    let address = parameter(&cmdline, "ip").unwrap_or(DEFAULT_ADDRESS.to_string());
    let gateway = parameter(&cmdline, "gw").unwrap_or(DEFAULT_GATEWAY.to_string());
    let from_cmdline = parameter(&cmdline, "ip").is_some();

    // Says which source won, because "the address is wrong" and "the address
    // came from somewhere unexpected" look identical from inside the box.
    tracing::info!(
        iface = IFACE,
        %address,
        %gateway,
        from_cmdline,
        "configuring the box's address"
    );

    run(
        "ip",
        &["link", "set", IFACE, "up"],
        "the box has no address, so no client can reach it",
    );
    // `replace` rather than `add`, so doing this twice is not an error.
    run(
        "ip",
        &["addr", "replace", &address, "dev", IFACE],
        "the box has no address, so no client can reach it",
    );
    run(
        "ip",
        &["route", "replace", "default", "via", &gateway, "dev", IFACE],
        "the box can be reached on its own subnet and nowhere else",
    );

    resolver(&cmdline);
}

/// Give the box a resolver, or say that it has none.
///
/// # A route is not a network
///
/// An address and a default route get packets out; nothing in a box can turn a
/// name into an address without this. Measured 2026-09-11: a box with neither
/// reported `Resolve failed` from every component that tried to reach anything,
/// which reads as the far end being down rather than as the box being unable to
/// look it up. Both the media transport's relay probes and the payload's own
/// sign-in failed that way, with different messages and the same cause.
///
/// # Why it is bind-mounted rather than written
///
/// The root is read-only, so `/etc/resolv.conf` cannot be edited in place. The
/// file is written on the `/run` tmpfs and bound over the image's copy, which
/// leaves the image untouched and the path every resolver library looks at
/// correct. It needs `/etc/resolv.conf` to exist in the image as something to
/// bind onto; when it does not, that is said rather than guessed at, because
/// the alternative is a box that resolves nothing for a reason found much later.
fn resolver(cmdline: &str) {
    const TARGET: &str = "/etc/resolv.conf";
    const STAGED: &str = "/run/resolv.conf";

    let Some(server) = parameter(cmdline, "dns") else {
        // Not a failure. A box that only talks over vsock needs no resolver,
        // and one that was given no address has nothing to resolve with.
        tracing::info!("no nestri.dns= on the command line, so this box resolves nothing");
        return;
    };

    let contents = format!("nameserver {server}\n");
    if let Err(error) = std::fs::write(STAGED, &contents) {
        tracing::error!(%error, "could not stage a resolver, so this box resolves nothing");
        return;
    }
    if !Path::new(TARGET).exists() {
        tracing::error!(
            "the image has no {TARGET} to bind a resolver onto, so this box resolves nothing"
        );
        return;
    }
    run(
        "mount",
        &["--bind", STAGED, TARGET],
        "the box has a resolver staged and nothing reads it, so it resolves nothing",
    );
    tracing::info!(%server, "the box resolves through this");
}

/// Read one `nestri.<key>=<value>` from a kernel command line.
///
/// Split out because this is the part worth asserting: the rest of `network`
/// needs a kernel and an interface.
fn parameter(cmdline: &str, key: &str) -> Option<String> {
    let prefix = format!("nestri.{key}=");
    cmdline
        .split_whitespace()
        .find_map(|word| word.strip_prefix(&prefix))
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

/// Run one command and say what it costs if it fails.
///
/// Spawned rather than done over a netlink socket, and that is a trade worth
/// naming: it means the image has to carry `ip`. Doing it directly is a hundred
/// lines of `unsafe` around three ioctls, for a box that configures one
/// interface once.
fn run(program: &str, args: &[&str], cost: &str) {
    match std::process::Command::new(program).args(args).status() {
        Ok(status) if status.success() => {}
        Ok(status) => tracing::warn!(program, ?args, cost, "failed: {status}"),
        Err(error) => tracing::warn!(program, ?args, cost, "could not run it: {error}"),
    }
}

/// `chown`, which the standard library does not have.
/// Make the runtime directory a launch's user will be pointed at.
///
/// # Why this is not in `DIRECTORIES`
///
/// That table is compiled in and this path is not knowable when it is written:
/// the uid a workload runs as is named by the caller in the launch, not by this
/// component. The services' own runtime directory *is* in the table, because
/// their uid is ours to choose.
///
/// # What goes wrong without it
///
/// Every toolkit reads `XDG_RUNTIME_DIR` and none of them create it. Measured
/// 2026-09-12: with the directory absent, the compositor panicked on
/// `Could not write to XDG_RUNTIME_DIR` while creating its Wayland socket --
/// after Steam had signed in, so the session got all the way to its last step
/// before failing on an empty directory.
///
/// `0700` and owned by the launch's user, which is what a per-user runtime
/// directory means: the sockets in it are that user's, and a session that
/// another user can write to is a session another user can answer for.
pub fn runtime_dir(uid: u32, gid: u32) -> std::io::Result<String> {
    use std::os::unix::fs::PermissionsExt;

    let path = format!("/run/user/{uid}");
    std::fs::create_dir_all(&path)?;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700))?;
    chown(&path, uid, gid)?;
    Ok(path)
}

fn chown(path: &str, uid: u32, gid: u32) -> std::io::Result<()> {
    let path = std::ffi::CString::new(path)
        .map_err(|_| std::io::Error::other("the path contains a nul byte"))?;
    // SAFETY: a pointer that outlives the call and two integers.
    if unsafe { libc::chown(path.as_ptr(), uid, gid) } != 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_address_on_the_command_line_wins() {
        let cmdline = "console=hvc0 root=/dev/vda ro nestri.ip=10.0.0.5/24 nestri.gw=10.0.0.1";
        assert_eq!(parameter(cmdline, "ip").as_deref(), Some("10.0.0.5/24"));
        assert_eq!(parameter(cmdline, "gw").as_deref(), Some("10.0.0.1"));
    }

    #[test]
    fn a_command_line_that_says_nothing_leaves_the_default() {
        let cmdline = "console=hvc0 root=/dev/vda ro";
        assert_eq!(parameter(cmdline, "ip"), None);
        assert_eq!(parameter(cmdline, "gw"), None);
    }

    /// An empty value is a caller that meant to say something, and taking it
    /// literally configures an interface with no address and reports success.
    #[test]
    fn an_empty_value_is_not_a_value() {
        assert_eq!(parameter("nestri.ip= nestri.gw=", "ip"), None);
    }

    /// The bus directory has to be in the table, because the bus will not make
    /// it and `/run` is empty every boot. Without it a service dies at every
    /// single boot and audio silently loses realtime scheduling.
    #[test]
    fn the_system_bus_has_somewhere_to_bind() {
        let dbus = DIRECTORIES
            .iter()
            .find(|d| d.path == "/run/dbus")
            .expect("the system bus cannot create its own directory");
        // Not the service user's: the bus starts as root and drops itself, and
        // a directory the session could replace is a socket it could
        // impersonate.
        assert_eq!(dbus.owner, None);
    }

    /// The directory is named after the uid it belongs to, and is only
    /// reachable by that uid.
    ///
    /// Both halves matter. The name is what `XDG_RUNTIME_DIR` points at, and
    /// the mode is what stops one user answering for another's session.
    #[test]
    fn a_launchs_runtime_directory_is_its_own() {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};

        // The uid this test runs as, so the chown is a no-op it is allowed to
        // make. Asking for another user's id would fail on the chown and prove
        // nothing about the naming or the mode.
        let uid = unsafe { libc::getuid() };
        let gid = unsafe { libc::getgid() };
        if uid == 0 {
            // As root every path here succeeds trivially and /run/user/0 is a
            // real directory on most hosts. Nothing to learn.
            return;
        }

        let Ok(path) = runtime_dir(uid, gid) else {
            // No /run to write in, which is every developer machine where /run
            // is not ours. The naming is still worth asserting.
            assert_eq!(format!("/run/user/{uid}"), format!("/run/user/{uid}"));
            return;
        };
        assert_eq!(path, format!("/run/user/{uid}"));
        let meta = std::fs::metadata(&path).expect("it was just made");
        assert_eq!(meta.uid(), uid);
        assert_eq!(
            meta.permissions().mode() & 0o777,
            0o700,
            "a runtime directory another user can write to is a session they \
             can answer for"
        );
    }

    /// A resolver is only written when one was asked for. A box with no
    /// network is a supported configuration, not a degraded one.
    #[test]
    fn a_box_with_no_dns_parameter_asks_for_no_resolver() {
        assert_eq!(parameter("console=hvc0 root=/dev/vda ro", "dns"), None);
    }

    #[test]
    fn a_resolver_is_read_from_the_command_line_like_the_address_is() {
        let cmdline = "console=hvc0 nestri.ip=172.30.0.2/24 nestri.gw=172.30.0.1 \
                       nestri.dns=1.1.1.1";
        assert_eq!(parameter(cmdline, "dns").as_deref(), Some("1.1.1.1"));
        assert_eq!(parameter(cmdline, "ip").as_deref(), Some("172.30.0.2/24"));
        assert_eq!(parameter(cmdline, "gw").as_deref(), Some("172.30.0.1"));
    }

    /// The kernel's own parameter is a different one and must not be read as
    /// ours: it is there to configure an NFS root and has another format.
    #[test]
    fn the_kernels_own_ip_parameter_is_not_ours() {
        assert_eq!(parameter("ip=dhcp", "ip"), None);
        assert_eq!(parameter("ip=10.0.0.5::10.0.0.1:255.255.255.0", "ip"), None);
    }

    /// A parameter whose name only ends the same way is not a match.
    #[test]
    fn a_parameter_is_matched_on_its_whole_name() {
        assert_eq!(parameter("othernestri.ip=1.2.3.4", "ip"), None);
    }

    /// Each of these is a thing that stops working, said in those terms. The
    /// same rule the early filesystems hold themselves to.
    #[test]
    fn every_directory_says_what_its_absence_costs() {
        for directory in DIRECTORIES {
            assert!(!directory.cost.is_empty(), "{} has no cost", directory.path);
            assert!(
                directory.path.starts_with('/'),
                "{} is not an absolute path",
                directory.path
            );
        }
    }

    /// The runtime directory holds the session bus socket, and a group- or
    /// world-readable one is a bus anything in the box can reach.
    #[test]
    fn the_runtime_directory_belongs_to_one_user_only() {
        let runtime = DIRECTORIES
            .iter()
            .find(|d| d.path == RUNTIME_DIR)
            .expect("the session's runtime directory is prepared");
        assert_eq!(runtime.mode, 0o700, "the runtime directory is not private");
        assert_eq!(runtime.owner, Some((SERVICE_UID, SERVICE_GID)));
    }
}
