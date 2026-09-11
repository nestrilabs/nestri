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
