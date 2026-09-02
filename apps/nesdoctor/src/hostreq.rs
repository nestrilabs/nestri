//! Can this machine run a box?
//!
//! One check per hard requirement for running a box, in the order our host
//! requirements list them. This is the first thing that has ever *executed* that
//! list — until now a host was qualified by a human reading a table, and a
//! requirement nothing can check is a requirement that is silently optional.
//!
//! Three deliberate limits, stated because a green result here is not a promise:
//!
//! - **`vulkaninfo` is not sufficient by itself.** The contract says so twice,
//!   we have had the case that proves it: extension present, path still broken. So the encode row reports what the extension list says
//!   and labels it as such.
//! - **The renderer is not checked at all, on purpose.** It used to be, and the
//!   row could only ever say "present, patch state unknown" — which is a row
//!   that cannot pass. The box now carries its own virglrenderer and Mesa
//!   inside the image it runs in, so the host's copies are not on the path and
//!   asking about them told a prospective host their machine was wrong when it
//!   was not.
//! - **Nothing here is measured under load.** A host that passes every row can
//!   still fail on block I/O, which is the real density ceiling and needs a
//!   benchmark rather than a probe.

use serde::Serialize;

use crate::sys::{self, SysInfo};

/// A single requirement's outcome.
///
/// `Unknown` is a first-class result and is never collapsed into `Fail`. The
/// difference matters: a failed check is a machine that cannot host, an unknown
/// one is a machine we could not ask, and reporting the second as the first is
/// how you lose a capable host to a missing `lspci`.
#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum State {
    Pass,
    Fail,
    Unknown,
}

#[derive(Debug, Serialize, Clone)]
pub struct Check {
    pub id: &'static str,
    pub what: &'static str,
    pub state: State,
    pub detail: String,
    /// True when a `Fail` here means the machine cannot host at all.
    pub blocking: bool,
}

#[derive(Debug, Serialize)]
pub struct HostReport {
    pub checks: Vec<Check>,
    /// `true` only when no blocking check failed.
    pub could_host: bool,
    /// Blocking checks we could not determine. A host with these is a
    /// *maybe*, and saying so is the point.
    pub unknowns: usize,
}

pub fn probe(sys: &SysInfo) -> HostReport {
    let mut c: Vec<Check> = Vec::new();

    // Not Linux: every row below is meaningless, and pretending otherwise
    // produces a page of red for a machine that was never a candidate. A
    // Windows box is a *client*, which is a perfectly good thing to be.
    if sys.os != "linux" {
        c.push(Check {
            id: "os",
            what: "Linux with KVM",
            state: State::Fail,
            detail: format!(
                "this is {}. A host must be Linux; nesbox is a microVM hypervisor. \
                 As a client, this machine is fine and nothing below applies.",
                sys.os
            ),
            blocking: true,
        });
        return HostReport {
            could_host: false,
            unknowns: 0,
            checks: c,
        };
    }

    // --- KVM -------------------------------------------------------------
    let kvm = sys::exists("/dev/kvm");
    let kvm_rw = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open("/dev/kvm")
        .is_ok();
    c.push(Check {
        id: "kvm",
        what: "/dev/kvm present and openable",
        state: if kvm_rw { State::Pass } else { State::Fail },
        detail: match (kvm, kvm_rw) {
            (true, true) => "yes".into(),
            (true, false) => {
                "present but not openable — you are not in the `kvm` group, or virtualisation \
                 is disabled in firmware"
                    .into()
            }
            _ => {
                "missing — enable SVM/VT-x in firmware, or this is a VM without nested virt".into()
            }
        },
        blocking: true,
    });

    // --- GPU vendor and render node --------------------------------------
    let usable: Vec<_> = sys
        .gpus
        .iter()
        .filter(|g| {
            g.render_node.is_some() && matches!(g.vendor.as_deref(), Some("AMD") | Some("Intel"))
        })
        .collect();
    let nvidia_only = !sys.gpus.is_empty()
        && sys
            .gpus
            .iter()
            .all(|g| g.vendor.as_deref() == Some("NVIDIA"));
    c.push(Check {
        id: "gpu",
        what: "an AMD or Intel GPU with a DRM render node",
        state: if !usable.is_empty() {
            State::Pass
        } else {
            State::Fail
        },
        detail: if let Some(g) = usable.first() {
            format!(
                "{} at {}",
                g.name,
                g.render_node.clone().unwrap_or_default()
            )
        } else if nvidia_only {
            "NVIDIA only. Nvidia needs virtio-nvgpu, which is not funded — so this card \
             cannot host today. It is a fine client."
                .into()
        } else if sys.gpus.is_empty() {
            "no GPU found under /sys/class/drm".into()
        } else {
            format!(
                "found {} but none with both a supported vendor and a render node",
                sys.gpus.len()
            )
        },
        blocking: true,
    });

    // --- Vulkan Video encode ---------------------------------------------
    // The contract is explicit that this is stricter than "has a hardware
    // encoder": VA-API and NVENC are far more common than this extension, so a
    // machine can encode well and still fail.
    // `--summary` is NOT usable here and the order used to be the other way
    // round. Measured on the development laptop 2026-09-02: `vulkaninfo
    // --summary` lists **zero** `VK_KHR_video*` entries while full `vulkaninfo`
    // lists five on the same machine — so preferring the summary reported "not
    // advertised" on a card that advertises it, which is a false negative on
    // the one check most likely to disqualify a host.
    let vk = sys::sh("vulkaninfo", &[]).unwrap_or_default();
    let has_encode_q = vk.contains("VK_KHR_video_encode_queue");
    let has_codec = vk.contains("VK_KHR_video_encode_h264")
        || vk.contains("VK_KHR_video_encode_h265")
        || vk.contains("VK_KHR_video_encode_av1");
    c.push(Check {
        id: "vkvideo",
        what: "VK_KHR_video_encode_queue plus a codec extension",
        state: if vk.is_empty() {
            State::Unknown
        } else if has_encode_q && has_codec {
            State::Pass
        } else {
            State::Fail
        },
        detail: if vk.is_empty() {
            "vulkaninfo not installed, so this could not be checked. Install `vulkan-tools`.".into()
        } else if has_encode_q && has_codec {
            "extensions present. Note: presence is not proof — a working extension list with a \
             broken path has happened here before, so this row is a necessary and not a \
             sufficient condition."
                .into()
        } else if has_encode_q {
            "encode queue present but no codec extension found".into()
        } else {
            "not advertised. This is stricter than 'has a hardware encoder': VA-API and NVENC \
             are much more common than this extension."
                .into()
        },
        blocking: true,
    });

    // --- two stores -------------------------------------------------------
    // ZFS for content, direct-I/O-capable for box images, and not the same
    // filesystem, because ZFS ignores `O_DIRECT`.
    let zfs_mounts: Vec<&crate::sys::Disk> = sys
        .disks
        .iter()
        .filter(|d| d.fs.as_deref() == Some("zfs"))
        .collect();
    c.push(Check {
        id: "content-store",
        what: "a ZFS pool for game datasets",
        state: if zfs_mounts.is_empty() {
            State::Fail
        } else {
            State::Pass
        },
        detail: if let Some(d) = zfs_mounts.first() {
            format!("{} ({:.0} GiB free)", d.mount, d.free_gib)
        } else {
            "no ZFS mount found. One dataset per game, cloned per player, is the whole of the \
             content store — no other filesystem gives clones and send/recv."
                .into()
        },
        blocking: false,
    });

    // "Its own device" is part of the requirement, not a nicety: separate
    // devices keep a box's disk latency out of a game download's write path.
    let root_dev = sys
        .disks
        .iter()
        .find(|d| d.mount == "/")
        .and_then(|d| d.source.clone());
    let box_store = sys.disks.iter().find(|d| {
        matches!(d.fs.as_deref(), Some("ext4") | Some("xfs"))
            && d.mount != "/"
            && d.source.is_some()
            && d.source != root_dev
            && d.free_gib >= 64.0
    });
    c.push(Check {
        id: "box-store",
        what: "ext4 or xfs, not /, for box images (O_DIRECT)",
        state: match box_store {
            Some(_) => State::Pass,
            None => State::Fail,
        },
        detail: match box_store {
            Some(d) => format!(
                "{} on {} ({:.0} GiB free)",
                d.mount,
                d.fs.clone().unwrap_or_default(),
                d.free_gib
            ),
            None => "none found. A box image must be openable O_DIRECT or the box has no storage \
                     bound at all — ZFS ignores the flag, and a warm page cache let a capped \
                     guest read at 13.3 GB/s against a 20 MB/s cap. Games are hundreds of GiB, \
                     so / is not an option either."
                .into(),
        },
        blocking: false,
    });

    // --- cgroup io delegation --------------------------------------------
    // `io.max` is applied per box, and a user session gets `cpu memory pids`
    // but not `io` — so an unprivileged bound has nothing to attach to.
    let io_ctrl = std::fs::read_to_string("/sys/fs/cgroup/cgroup.controllers")
        .map(|s| s.split_whitespace().any(|w| w == "io"))
        .unwrap_or(false);
    c.push(Check {
        id: "cgroup-io",
        what: "the io cgroup controller available",
        state: if io_ctrl { State::Pass } else { State::Fail },
        detail: if io_ctrl {
            "present at the root".into()
        } else {
            "not available. Without it a per-box io.max silently has nothing to attach to.".into()
        },
        blocking: false,
    });

    // --- virtiofsd --------------------------------------------------------
    let virtiofsd = [
        "/usr/bin/virtiofsd",
        "/usr/libexec/virtiofsd",
        "/usr/lib/virtiofsd",
    ]
    .iter()
    .find(|p| sys::exists(p));
    c.push(Check {
        id: "virtiofsd",
        what: "virtiofsd, for shared directories into the guest",
        state: if virtiofsd.is_some() {
            State::Pass
        } else {
            State::Unknown
        },
        detail: match virtiofsd {
            Some(p) => (*p).to_string(),
            None => "not found in the usual places; it may still be packaged elsewhere".into(),
        },
        blocking: false,
    });

    let unknowns = c
        .iter()
        .filter(|k| k.blocking && k.state == State::Unknown)
        .count();
    let could_host = !c.iter().any(|k| k.blocking && k.state == State::Fail);

    HostReport {
        checks: c,
        could_host,
        unknowns,
    }
}
