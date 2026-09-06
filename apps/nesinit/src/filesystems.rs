// The filesystems PID 1 has to establish before anything asks for them.
//
// The root arrives read-only — the host attaches it that way and nothing in
// the guest may write to it — and there is no init system behind this process
// to make up the difference. So a guest gets `/proc`, and it gets somewhere to
// put a socket, only if this mounts them.
//
// Without that the failure is not an error anyone sees. Everything that needs
// a writable path fails one layer down, separately, as `EROFS` on a socket:
// the payload relay never binds, whatever serves the session's address never
// binds either, and the session is reported as a workload that ran and
// published nothing. Three unrelated-looking symptoms, one missing mount.

use std::ffi::CString;
use std::path::Path;

/// A filesystem this process mounts, and why it has to exist.
struct Early {
    /// What appears in `/proc/mounts` as the source. Conventionally the type.
    source: &'static str,
    target: &'static str,
    fstype: &'static str,
    flags: libc::c_ulong,
    /// Mount options, or empty for none.
    data: &'static str,
    /// Said when it could not be mounted, in terms of what stops working.
    cost: &'static str,
}

/// `nosuid` and `nodev` on everything: none of these carry an image's files,
/// so a device node or a setuid bit appearing in one did not come from us.
const NOSUID_NODEV: libc::c_ulong = libc::MS_NOSUID | libc::MS_NODEV;

const EARLY: &[Early] = &[
    Early {
        source: "proc",
        target: "/proc",
        fstype: "proc",
        flags: NOSUID_NODEV | libc::MS_NOEXEC,
        data: "",
        cost: "this process cannot make itself ineligible for the OOM killer, \
               and nothing in the guest can read its own state",
    },
    Early {
        source: "sysfs",
        target: "/sys",
        fstype: "sysfs",
        flags: NOSUID_NODEV | libc::MS_NOEXEC,
        data: "",
        cost: "a workload that looks up a device finds nothing",
    },
    // Writable, and the reason any of this is here. Both sockets in this
    // component live on a tmpfs because the root they would otherwise sit on
    // is read-only.
    Early {
        source: "tmpfs",
        target: "/tmp",
        fstype: "tmpfs",
        flags: NOSUID_NODEV,
        // The sticky bit, because the workload does not run as this process
        // does and what it binds here is its own.
        data: "mode=1777",
        cost: "whatever serves this session's address cannot bind its socket, \
               so the session never gets one",
    },
    // `/run` before anything under it, for the same reason `/proc` comes first:
    // a directory cannot be created inside a mount that is not there, and the
    // root it would otherwise land on is read-only.
    Early {
        source: "tmpfs",
        target: "/run",
        fstype: "tmpfs",
        flags: NOSUID_NODEV,
        // Octal, and without a leading zero on purpose: the kernel parses a
        // tmpfs mode as octal either way, and this is the spelling `mount`
        // itself documents.
        data: "mode=755",
        cost: "there is nowhere for a runtime socket to live, so neither the \
               payload relay nor this session's address can be served",
    },
    // The relay's own directory, and it is deliberately **not** in the tree the
    // session's shares live in.
    //
    // It was, and that was wrong in a way no test here would have caught: a
    // fresh tmpfs over the share tree hides every directory the image prepared
    // underneath it — the install, the user state, the work directory, and the
    // mount point the log share is attached to from `fstab`. The box then has a
    // socket and none of the places its workload expects to find its files, and
    // the exact-path check below cannot notice, because what `fstab` mounts is
    // a directory *inside* that tree rather than the tree itself.
    //
    // Owned by this process and writable by nothing else, which is what makes
    // the socket in it unreplaceable. The workload reaches it because the
    // directory is traversable and the socket itself is not restricted; see
    // `payload::serve`.
    Early {
        source: "tmpfs",
        target: crate::payload::DIRECTORY,
        fstype: "tmpfs",
        flags: NOSUID_NODEV | libc::MS_NOEXEC,
        data: "mode=755",
        cost: "the payload relay cannot bind, so nothing reaches the workload \
               over the channel",
    },
];

/// Mount what the rest of this component assumes is already there.
///
/// Best effort, one line per failure. Refusing to boot over any of these would
/// replace a session that fails with a reason with a guest that never dialled
/// out at all, and the second is strictly harder to diagnose from the host.
pub fn establish() {
    // `/proc` first and unconditionally: it is the only way to find out what is
    // already mounted, so everything after it can be skipped when an image has
    // done it already, and it cannot itself be checked that way.
    mount(&EARLY[0]);

    let existing = std::fs::read_to_string("/proc/self/mountinfo").unwrap_or_default();
    for early in &EARLY[1..] {
        if mounted_at(&existing, early.target) {
            tracing::debug!(target = early.target, "already mounted by the image");
            continue;
        }
        mount(early);
    }
}

/// Whether `mountinfo` already has a mount at this exact path.
///
/// The mount point is the fifth field and it is the one that has to match:
/// a prefix test would read `/tmpfoo` as `/tmp`, and a substring test would
/// find the path in the options of something else entirely.
fn mounted_at(mountinfo: &str, target: &str) -> bool {
    mountinfo
        .lines()
        .filter_map(|line| line.split_whitespace().nth(4))
        .any(|point| point == target)
}

fn mount(early: &Early) {
    // A mount point that is not in the image cannot be created on a read-only
    // root, so this is allowed to fail and the mount below reports it.
    if !Path::new(early.target).exists() {
        let _ = std::fs::create_dir_all(early.target);
    }

    let (Ok(source), Ok(target), Ok(fstype), Ok(data)) = (
        CString::new(early.source),
        CString::new(early.target),
        CString::new(early.fstype),
        CString::new(early.data),
    ) else {
        // Every one of these is a literal in this file, so this is
        // unreachable rather than a case to handle.
        tracing::error!(target = early.target, "a mount table entry has a nul byte");
        return;
    };
    let data = if early.data.is_empty() {
        std::ptr::null()
    } else {
        data.as_ptr().cast()
    };

    // SAFETY: four pointers that outlive the call, and a flag word.
    let mounted = unsafe {
        libc::mount(
            source.as_ptr(),
            target.as_ptr(),
            fstype.as_ptr(),
            early.flags,
            data,
        )
    };
    if mounted != 0 {
        tracing::warn!(
            target = early.target,
            error = %std::io::Error::last_os_error(),
            cost = early.cost,
            "could not mount"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The whole point of reading `mountinfo` is to not mount twice over
    /// something an image already did.
    #[test]
    fn a_mount_point_that_is_present_is_recognised() {
        let info = "\
23 1 0:5 / /proc rw,nosuid,nodev,noexec - proc proc rw
24 1 0:6 / /tmp rw,nosuid,nodev - tmpfs tmpfs rw,mode=1777";
        assert!(mounted_at(info, "/proc"));
        assert!(mounted_at(info, "/tmp"));
    }

    /// A prefix is not a mount point, and neither is a path that only appears
    /// in another line's options.
    #[test]
    fn something_else_is_not_mistaken_for_a_mount_point() {
        let info = "\
23 1 0:5 / /tmpfoo rw - tmpfs tmpfs rw
24 1 0:6 / /var rw - ext4 /dev/vda rw,journal_path=/nestri";
        assert!(!mounted_at(info, "/tmp"));
        assert!(!mounted_at(info, "/nestri"));
    }

    /// Every entry has to be nul-free, because `establish` treats a nul as
    /// unreachable rather than handling it.
    #[test]
    fn the_mount_table_can_be_carried_out() {
        for early in EARLY {
            assert!(CString::new(early.source).is_ok(), "{}", early.target);
            assert!(CString::new(early.target).is_ok(), "{}", early.target);
            assert!(CString::new(early.fstype).is_ok(), "{}", early.target);
            assert!(CString::new(early.data).is_ok(), "{}", early.target);
            assert!(!early.cost.is_empty(), "{} has no cost", early.target);
        }
    }

    /// `/proc` is mounted before `mountinfo` is read, so it has to be first.
    #[test]
    fn proc_is_the_first_entry() {
        assert_eq!(EARLY[0].target, "/proc");
    }

    /// A mount has to come after whatever it lives inside, or it is a
    /// directory created on a read-only root and the mount fails.
    #[test]
    fn nothing_is_mounted_before_the_mount_it_lives_inside() {
        for (i, early) in EARLY.iter().enumerate() {
            for other in &EARLY[i + 1..] {
                assert!(
                    !early.target.starts_with(&format!("{}/", other.target)),
                    "{} is mounted before {}, which contains it",
                    early.target,
                    other.target
                );
            }
        }
    }

    /// **Nothing here may be mounted over the tree the session's shares live
    /// in.** A fresh tmpfs there hides every directory the image prepared
    /// underneath — the install, the user state, the work directory, and the
    /// mount point the log share attaches to — and the exact-path check cannot
    /// notice, because what is mounted from `fstab` is a directory inside that
    /// tree rather than the tree itself. So a box would come up with a socket
    /// and without any of the places its workload looks for its files.
    #[test]
    fn the_share_tree_is_never_mounted_over() {
        for early in EARLY {
            assert_ne!(
                early.target, "/nestri",
                "this hides the directories the image prepared for a session"
            );
        }
    }

    /// The relay's directory is the one this cannot hardcode: it belongs to
    /// `payload`, and a rename there that missed this file would take the
    /// relay down again in exactly the way this exists to prevent.
    #[test]
    fn the_relay_directory_is_the_one_the_relay_uses() {
        let entry = EARLY
            .iter()
            .find(|e| e.target == crate::payload::DIRECTORY)
            .expect("the relay's directory is mounted");
        assert!(
            crate::payload::SOCKET.starts_with(entry.target),
            "the relay's socket is not under the directory that is mounted for it"
        );
    }
}
