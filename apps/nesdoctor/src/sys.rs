//! What the machine is: OS, CPU, memory, GPU, disk, and how long it stays on.
//!
//! Everything here is read from files or from a command that ships with the OS.
//! No crate is used to describe hardware, because a wrong answer from a
//! dependency is indistinguishable from a wrong answer from us, and this output
//! is what a host-capacity decision would rest on: hosts are
//! customer-supplied and heterogeneous, so an unlabelled capacity number is a
//! wrong one.
//!
//! Every probe degrades to `None` rather than failing the run. A missing
//! `lspci` costs one field.

// Every probe in this module is a stack of `#[cfg]`-gated `return`s, one per
// platform, so that exactly one compiles. The trailing `return` in each arm is
// load-bearing -- dropping it makes the arms fall through to each other and the
// function stops compiling on some targets -- so clippy's advice is wrong here
// specifically, and is not suppressed anywhere else in the crate.
#![allow(clippy::needless_return)]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct SysInfo {
    pub os: &'static str,
    pub arch: &'static str,
    pub release: Option<String>,
    pub kernel: Option<String>,
    pub cpu_model: Option<String>,
    pub cpu_threads: usize,
    pub ram_gib: Option<f64>,
    pub gpus: Vec<Gpu>,
    /// Mounts with usable free space, largest first.
    pub disks: Vec<Disk>,
    pub uptime_hours: Option<f64>,
    /// Mean hours per day the machine was powered, from boot history. See
    /// [`powered`]. `None` where the history is not readable.
    pub powered_hours_per_day: Option<f64>,
    /// Days the boot history spans, so the reader can judge the above.
    pub powered_span_days: Option<f64>,
}

#[derive(Debug, Serialize, Clone)]
pub struct Gpu {
    pub name: String,
    pub vendor: Option<String>,
    /// The DRM render node, where one exists. Linux only, and a hard
    /// requirement in `contracts/host-requirements.md`: a card without one
    /// cannot host, however good it is.
    pub render_node: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct Disk {
    pub mount: String,
    pub fs: Option<String>,
    /// The backing device. Kept because btrfs and ZFS present many mount
    /// points on one device: without this, three subvolumes of one 91 GiB disk
    /// read as 273 GiB of capacity, and the two-stores check (which wants
    /// *separate devices*) cannot be answered at all.
    pub source: Option<String>,
    pub free_gib: f64,
    /// Total capacity, not just what is free.
    ///
    /// Added after a submission from a machine with four drives and 22 TiB
    /// reported `disk=8880` -- the free space on the single largest mount. A
    /// content store is sized against capacity, and reporting only the largest
    /// mount's free space understates a multi-drive machine by however many
    /// drives it has.
    pub size_gib: Option<f64>,
}

pub fn probe() -> SysInfo {
    let (powered_hours_per_day, powered_span_days) = powered();
    SysInfo {
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        release: release(),
        kernel: kernel(),
        cpu_model: cpu_model(),
        cpu_threads: std::thread::available_parallelism().map_or(0, |n| n.get()),
        ram_gib: ram_gib(),
        gpus: gpus(),
        disks: disks(),
        uptime_hours: uptime_hours(),
        powered_hours_per_day,
        powered_span_days,
    }
}

// ---------------------------------------------------------------- identity ---

fn release() -> Option<String> {
    #[cfg(target_os = "linux")]
    return kv_line(&fs::read_to_string("/etc/os-release").ok()?, "PRETTY_NAME");
    #[cfg(windows)]
    return ps("(Get-CimInstance Win32_OperatingSystem).Caption");
    #[cfg(target_os = "macos")]
    return sh("sw_vers", &["-productVersion"]).map(|v| format!("macOS {v}"));
    #[cfg(not(any(target_os = "linux", windows, target_os = "macos")))]
    return None;
}

fn kernel() -> Option<String> {
    if cfg!(windows) {
        return None;
    }
    sh("uname", &["-r"])
}

fn cpu_model() -> Option<String> {
    #[cfg(target_os = "linux")]
    return fs::read_to_string("/proc/cpuinfo")
        .ok()?
        .lines()
        .find(|l| l.starts_with("model name"))
        .and_then(|l| l.split_once(':'))
        .map(|(_, v)| v.trim().to_string());
    #[cfg(windows)]
    return ps("(Get-CimInstance Win32_Processor).Name");
    #[cfg(target_os = "macos")]
    return sh("sysctl", &["-n", "machdep.cpu.brand_string"]);
    #[cfg(not(any(target_os = "linux", windows, target_os = "macos")))]
    return None;
}

fn ram_gib() -> Option<f64> {
    #[cfg(target_os = "linux")]
    {
        let txt = fs::read_to_string("/proc/meminfo").ok()?;
        let kb: f64 = txt
            .lines()
            .find(|l| l.starts_with("MemTotal:"))?
            .split_whitespace()
            .nth(1)?
            .parse()
            .ok()?;
        return Some(kb / 1048576.0);
    }
    #[cfg(windows)]
    return Some(
        ps("(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory")?
            .trim()
            .parse::<f64>()
            .ok()?
            / 1073741824.0,
    );
    #[cfg(target_os = "macos")]
    return Some(
        sh("sysctl", &["-n", "hw.memsize"])?
            .trim()
            .parse::<f64>()
            .ok()?
            / 1073741824.0,
    );
    #[cfg(not(any(target_os = "linux", windows, target_os = "macos")))]
    return None;
}

// --------------------------------------------------------------------- gpu ---

/// PCI vendor ids as they appear in `/sys/.../vendor`.
fn vendor_name(id: &str) -> Option<&'static str> {
    match id.trim().trim_start_matches("0x") {
        "1002" => Some("AMD"),
        "8086" => Some("Intel"),
        "10de" => Some("NVIDIA"),
        _ => None,
    }
}

/// Adapters that are software, not hardware.
///
/// The first Windows submission we ever received reported
/// `gpu=Parsec Virtual Display Adapter` with `gpus=2`: Parsec installs an
/// indirect display driver, it enumerated first, and the real card was lost.
/// Every remote-play tool does this -- Parsec, Sunshine, Moonlight, TeamViewer,
/// Splashtop -- and a cloud-gaming audience is exactly the population that has
/// one installed. A recorded `gpu_model` is a hard requirement per our host
/// rules, and recording a virtual display driver satisfies it in name only.
/// Only consulted on Windows -- Linux adapters are found through DRM render
/// nodes, which a virtual display driver does not have -- but kept
/// unconditional so the list is compiled and unit-tested on every platform.
#[cfg_attr(not(windows), allow(dead_code))]
fn is_virtual_adapter(name: &str) -> bool {
    let n = name.to_lowercase();
    [
        "virtual",
        "basic display",
        "basic render",
        "remote display",
        "indirect display",
        "idd",
        "parsec",
        "sunshine",
        "teamviewer",
        "splashtop",
        "nomachine",
        "citrix",
        "vmware",
        "virtualbox",
        "hyper-v",
        "qxl",
        "meta virtual",
    ]
    .iter()
    .any(|p| n.contains(p))
}

fn gpus() -> Vec<Gpu> {
    #[cfg(target_os = "linux")]
    return linux_gpus();
    #[cfg(windows)]
    {
        // AdapterCompatibility carries the vendor, which is more reliable than
        // pattern-matching the marketing name -- an "AMD Radeon" string is easy,
        // an OEM-rebadged one is not.
        let raw = ps(
            r#"Get-CimInstance Win32_VideoController | ForEach-Object { "$($_.Name)|$($_.AdapterCompatibility)" }"#,
        )
        .unwrap_or_default();

        let mut out: Vec<Gpu> = raw
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .map(|l| {
                let (name, compat) = l.split_once('|').unwrap_or((l, ""));
                let hay = format!("{name} {compat}").to_uppercase();
                Gpu {
                    name: name.trim().to_string(),
                    vendor: [
                        ("AMD", "AMD"),
                        ("NVIDIA", "NVIDIA"),
                        ("INTEL", "Intel"),
                        ("ATI", "AMD"),
                    ]
                    .into_iter()
                    .find(|(needle, _)| hay.contains(needle))
                    .map(|(_, v)| v.to_string()),
                    render_node: None,
                }
            })
            .collect();

        // Real hardware first, so the primary is never a virtual adapter that
        // merely happened to enumerate earlier. Order is the only signal the
        // rest of the program has.
        out.sort_by_key(|g| (is_virtual_adapter(&g.name), g.vendor.is_none()));
        return out;
    }
    #[cfg(not(any(target_os = "linux", windows)))]
    return Vec::new();
}

/// Walk `/sys/class/drm` for cards and pair each with its render node.
#[cfg(target_os = "linux")]
fn linux_gpus() -> Vec<Gpu> {
    let mut out = Vec::new();
    let Ok(entries) = fs::read_dir("/sys/class/drm") else {
        return out;
    };
    let all: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();

    let mut cards: Vec<&PathBuf> = all
        .iter()
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with("card") && !n.contains('-'))
        })
        .collect();
    cards.sort();

    let lspci = sh("lspci", &["-mm"]).unwrap_or_default();

    for card in cards {
        let dev = card.join("device");
        let real = fs::canonicalize(&dev).ok();
        let vendor = fs::read_to_string(dev.join("vendor"))
            .ok()
            .and_then(|v| vendor_name(&v))
            .map(str::to_string);

        // The PCI slot is the symlink target's basename; lspci -mm keys on the
        // bus:device.function part of it.
        let slot = real
            .as_ref()
            .and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
            .unwrap_or_default();
        let bdf = slot
            .split_once(':')
            .map_or(slot.clone(), |(_, r)| r.to_string());

        let name = lspci
            .lines()
            .find(|l| l.starts_with(&bdf))
            // lspci -mm quotes each field; index 5 is the device name.
            .and_then(|l| l.split('"').nth(5).map(str::to_string))
            .or_else(|| {
                fs::read_to_string(dev.join("device")).ok().map(|d| {
                    format!(
                        "{} device {}",
                        vendor.clone().unwrap_or_else(|| "unknown".into()),
                        d.trim()
                    )
                })
            })
            .unwrap_or_else(|| "unknown GPU".into());

        let render_node = all
            .iter()
            .filter(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.starts_with("renderD"))
            })
            .find(|p| fs::canonicalize(p.join("device")).ok() == real)
            .and_then(|p| {
                p.file_name()
                    .map(|n| format!("/dev/dri/{}", n.to_string_lossy()))
            });

        // 0041 requires a *recorded* gpu_model per host, so prefer a name that
        // identifies the part. lspci gives the codename alone ("Barcelo"),
        // which is thin on its own.
        let name = match &vendor {
            Some(v) if !name.to_uppercase().contains(&v.to_uppercase()) => format!("{v} {name}"),
            _ => name,
        };
        out.push(Gpu {
            name,
            vendor,
            render_node,
        });
    }
    out
}

// -------------------------------------------------------------------- disk ---

fn disks() -> Vec<Disk> {
    let mut out = Vec::new();
    #[cfg(unix)]
    if let Some(txt) = sh("df", &["-Pk"]) {
        // -P for POSIX output and -k for a unit that does not move under
        // locale. Both matter, because this is parsed.
        for line in txt.lines().skip(1) {
            let f: Vec<&str> = line.split_whitespace().collect();
            if f.len() < 6 {
                continue;
            }
            // Counted from the RIGHT, not the left.
            //
            // `df -P` guarantees the column order but not that the filesystem
            // name is one word. macOS emits `map auto_home 0 0 0 100% /path`,
            // which shifts every field by one -- so indexing from the left read
            // the capacity percentage as the mount point and a device name as
            // the size. Found in the macOS CI log, where a row appeared as
            // `100% /System/Volumes/Data/home`.
            //
            // The trailing columns are fixed: ... size used avail capacity mount.
            let n = f.len();
            let mount = f[n - 1].to_string();
            let Ok(avail_kb) = f[n - 3].parse::<f64>() else {
                continue;
            };
            let size_kb = f[n - 5].parse::<f64>().ok();
            let source = f[..n - 5].join(" ");
            let fs = fs_type(&mount);

            // Filter by filesystem type, not by mount path. Filtering paths
            // missed `/tmp` on a tmpfs, whose "free space" is RAM -- so a
            // 7 GiB tmpfs was being added to a storage total, which is exactly
            // the sort of number a capacity plan would then be built on.
            const PSEUDO: [&str; 9] = [
                "tmpfs",
                "ramfs",
                "devtmpfs",
                "devfs",
                "squashfs",
                "overlay",
                "efivarfs",
                "fuse.portal",
                "iso9660",
            ];
            if fs.as_deref().is_some_and(|f| PSEUDO.contains(&f)) {
                continue;
            }
            // Paths still worth skipping regardless of what they are mounted as.
            //
            // `/System` is macOS: an APFS container presents Preboot, Update,
            // VM, xarts and a pile of signed asset bundles as separate
            // filesystems sharing one pool. None is user storage, and on a Mac
            // they are most of the rows.
            if [
                "/dev",
                "/sys",
                "/proc",
                "/run",
                "/boot",
                "/snap",
                "/var/lib/docker",
                "/System",
                "/private/var/vm",
                "/Volumes/Recovery",
            ]
            .iter()
            .any(|p| mount.starts_with(p))
            {
                continue;
            }
            // A filesystem with no capacity is not storage. `map auto_home`,
            // devfs and macOS asset bundles all report zero and would
            // otherwise pad the count in the summary line.
            if size_kb.is_some_and(|k| k < 1024.0) {
                continue;
            }
            out.push(Disk {
                fs,
                mount,
                source: Some(source),
                free_gib: avail_kb / 1048576.0,
                size_gib: size_kb.map(|k| k / 1048576.0),
            });
        }
    }
    #[cfg(windows)]
    // Free *and* Used, so capacity is Free + Used. `Get-PSDrive` reports both
    // and we were reading only Free.
    if let Some(txt) = ps(
        r#"Get-PSDrive -PSProvider FileSystem | ForEach-Object { "$($_.Name)|$($_.Free)|$($_.Used)" }"#,
    ) {
        for line in txt.lines() {
            let f: Vec<&str> = line.split('|').collect();
            if f.len() < 2 {
                continue;
            }
            let Ok(free) = f[1].trim().parse::<f64>() else {
                continue;
            };
            let used = f.get(2).and_then(|u| u.trim().parse::<f64>().ok());
            out.push(Disk {
                mount: format!("{}:", f[0].trim()),
                fs: None,
                source: None,
                free_gib: free / 1073741824.0,
                size_gib: used.map(|u| (free + u) / 1073741824.0),
            });
        }
    }
    out.sort_by(|a, b| b.free_gib.total_cmp(&a.free_gib));
    out.dedup_by(|a, b| a.mount == b.mount);
    // One entry per backing device. Measured 2026-09-02: this laptop reported
    // /, /home and /srv at 91 GiB each — three btrfs subvolumes of one device,
    // counted three times.
    out.dedup_by(|a, b| a.source.is_some() && a.source == b.source);

    // And one entry per *pool*, which a device name cannot see.
    //
    // Found by finally reading what the macOS CI runner prints: an APFS
    // container gives each volume its own `/dev/diskNsM`, so the device names
    // differ while the space is shared — eleven filesystems reporting
    // "483 GiB free of 1600 GiB" on a machine with 320 GiB. The same shape
    // appears with bind mounts and with thin-provisioned LVM.
    //
    // Two filesystems reporting byte-identical capacity *and* byte-identical
    // free space are the same store. Two genuinely separate disks agreeing to
    // the byte on both figures would cost one row; a storage total inflated
    // fivefold is a number a capacity plan gets built on.
    out.dedup_by(|a, b| {
        let same = |x: Option<f64>, y: Option<f64>| match (x, y) {
            (Some(x), Some(y)) => (x - y).abs() < 0.001,
            (None, None) => true,
            _ => false,
        };
        same(a.size_gib, b.size_gib) && (a.free_gib - b.free_gib).abs() < 0.001
    });
    out
}

/// The physical block devices behind a `df` source string.
///
/// A source string is not a device. `/dev/nvme0n1p2` and `/dev/nvme0n1p3` are
/// two strings and one SSD, sharing one queue — so comparing the strings says
/// "separate devices" about a topology with no I/O isolation whatever, which is
/// the entire reason the two-stores requirement exists. LVM is worse: two
/// logical volumes on one physical disk look completely unrelated.
///
/// So: a partition resolves to its parent disk through sysfs, a device-mapper
/// or MD device resolves to everything in its `slaves/` directory, recursively,
/// and anything unrecognised resolves to itself. Two mounts share hardware when
/// the returned sets intersect.
pub fn physical_devices(source: &str) -> Vec<String> {
    if !cfg!(target_os = "linux") {
        return vec![source.to_string()];
    }
    let name = source.rsplit('/').next().unwrap_or(source);
    let mut out = Vec::new();
    resolve_device(name, &mut out, 0);
    if out.is_empty() {
        out.push(name.to_string());
    }
    out.sort();
    out.dedup();
    out
}

fn resolve_device(name: &str, out: &mut Vec<String>, depth: u8) {
    // Stacked device mapper (LUKS over LVM over MD) nests, and a cycle would
    // otherwise be a hang in a diagnostic tool.
    if depth > 6 || name.is_empty() {
        return;
    }
    let base = format!("/sys/class/block/{name}");
    if !Path::new(&base).exists() {
        out.push(name.to_string());
        return;
    }

    // A partition: its sysfs parent directory is the whole disk.
    if Path::new(&format!("{base}/partition")).exists()
        && let Some(disk) = fs::canonicalize(&base)
            .ok()
            .and_then(|p| p.parent().map(|d| d.to_path_buf()))
            .and_then(|d| d.file_name().map(|n| n.to_string_lossy().into_owned()))
    {
        resolve_device(&disk, out, depth + 1);
        return;
    }

    // Device mapper, MD or anything else built on other devices.
    if let Ok(slaves) = fs::read_dir(format!("{base}/slaves")) {
        let mut any = false;
        for s in slaves.flatten() {
            any = true;
            resolve_device(&s.file_name().to_string_lossy(), out, depth + 1);
        }
        if any {
            return;
        }
    }

    out.push(name.to_string());
}

/// Filesystem type for a mount point.
///
/// `hostreq` needs this in both directions: ZFS is *required* for the content
/// store and *disqualifying* for the box store, because it ignores `O_DIRECT`
/// ignores `O_DIRECT`.
pub fn fs_type(mount: &str) -> Option<String> {
    if !cfg!(target_os = "linux") {
        return None;
    }
    // Last match wins: a later mount shadows an earlier one on the same point.
    fs::read_to_string("/proc/mounts")
        .ok()?
        .lines()
        .filter_map(|l| {
            let mut f = l.split_whitespace();
            let _src = f.next()?;
            let mnt = f.next()?;
            let ty = f.next()?;
            (mnt == mount).then(|| ty.to_string())
        })
        .next_back()
}

// ------------------------------------------------------------------ powered ---

fn uptime_hours() -> Option<f64> {
    #[cfg(target_os = "linux")]
    return Some(
        fs::read_to_string("/proc/uptime")
            .ok()?
            .split_whitespace()
            .next()?
            .parse::<f64>()
            .ok()?
            / 3600.0,
    );
    #[cfg(windows)]
    return ps(
        "[int]((Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime).TotalSeconds",
    )?
    .trim()
    .parse::<f64>()
    .ok()
    .map(|s| s / 3600.0);
    #[cfg(not(any(target_os = "linux", windows)))]
    return None;
}

/// Mean hours per day the machine was powered, and the span that covers.
///
/// This exists so no question has to ask *"how many hours is this machine
/// on?"* — which is exactly the kind of question nobody can answer about
/// themselves, so it should never be asked.
///
/// Method: `journalctl --list-boots -o json` gives a `first_entry` and
/// `last_entry` microsecond timestamp per boot. Summing `last − first` gives
/// time powered; `max(last) − min(first)` gives the wall-clock span. The ratio
/// is the answer, and it needs no date parsing at all — only integers.
///
/// It is a **coarse** instrument and is reported as one: it measures powered,
/// not idle, and a machine that suspends looks powered-off. It answers "always
/// on" versus "a few hours in the evening", which is the only resolution the
/// availability question needs at this stage.
pub fn powered() -> (Option<f64>, Option<f64>) {
    let Some(txt) = sh("journalctl", &["--list-boots", "-o", "json", "--no-pager"]) else {
        return (None, None);
    };
    let mut up_us: u128 = 0;
    let (mut lo, mut hi) = (u128::MAX, 0u128);
    let mut boots = 0usize;

    // Deliberately not a JSON parse: the shape is flat and stable, and pulling
    // the whole document through serde_json to read two integers per record
    // buys nothing.
    for first in txt.split("\"first_entry\":").skip(1) {
        let Some(a) = read_int(first) else { continue };
        let Some(rest) = first.split_once("\"last_entry\":") else {
            continue;
        };
        let Some(b) = read_int(rest.1) else { continue };
        if b <= a {
            continue;
        }
        up_us += b - a;
        lo = lo.min(a);
        hi = hi.max(b);
        boots += 1;
    }
    if boots < 2 || hi <= lo {
        return (None, None);
    }
    let span_days = (hi - lo) as f64 / 86_400_000_000.0;
    // Under three days this is one or two boots and says nothing about a
    // habit. Reporting it anyway invites someone to read "13 h/day" off two
    // days of history, so report the span with no rate instead.
    if span_days < 3.0 {
        return (None, Some(span_days));
    }
    let up_hours = up_us as f64 / 3_600_000_000.0;
    (Some(up_hours / span_days), Some(span_days))
}

fn read_int(s: &str) -> Option<u128> {
    let s = s.trim_start().trim_start_matches('"');
    let digits: String = s.chars().take_while(char::is_ascii_digit).collect();
    digits.parse().ok()
}

// ------------------------------------------------------------------- shell ---

/// Run a command, return trimmed stdout, `None` on any failure.
pub fn sh(cmd: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(cmd).args(args).output().ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!s.is_empty()).then_some(s)
}

/// PowerShell, for the Windows probes. `-NoProfile` so a user's profile script
/// cannot change what we read.
#[allow(dead_code)]
pub fn ps(script: &str) -> Option<String> {
    if !cfg!(windows) {
        return None;
    }
    sh(
        "powershell",
        &["-NoProfile", "-NonInteractive", "-Command", script],
    )
}

pub fn exists(p: &str) -> bool {
    Path::new(p).exists()
}

#[allow(dead_code)]
fn kv_line(txt: &str, key: &str) -> Option<String> {
    txt.lines()
        .find(|l| l.starts_with(&format!("{key}=")))
        .and_then(|l| l.split_once('='))
        .map(|(_, v)| v.trim().trim_matches('"').to_string())
}

#[cfg(test)]
mod tests {
    use super::is_virtual_adapter;

    /// The first Windows submission we received reported
    /// `Parsec Virtual Display Adapter` as the primary GPU on a machine that
    /// had a real one. This list is the fix, so it gets a test.
    #[test]
    fn virtual_adapters_are_recognised() {
        for name in [
            "Parsec Virtual Display Adapter",
            "Microsoft Basic Display Adapter",
            "Microsoft Remote Display Adapter",
            "Microsoft Hyper-V Video",
            "IddSampleDriver Device",
            "VMware SVGA 3D",
            "VirtualBox Graphics Adapter",
            "Citrix Indirect Display Adapter",
            "Splashtop Virtual Display",
        ] {
            assert!(is_virtual_adapter(name), "{name} should be virtual");
        }
    }

    #[test]
    fn real_cards_are_not_recognised_as_virtual() {
        for name in [
            "AMD Radeon RX 9060 XT",
            "NVIDIA GeForce RTX 4070",
            "Intel(R) Arc(TM) A310 Graphics",
            "AMD Barcelo",
            "Radeon RX 7900 XTX",
        ] {
            assert!(!is_virtual_adapter(name), "{name} should be real");
        }
    }

    /// `df -P` fixes the column order but not that the filesystem name is one
    /// word, so the columns are counted from the right. macOS emits
    /// `map auto_home 0 0 0 100% /path`, which shifted every field by one and
    /// made a capacity percentage into a mount point.
    #[test]
    fn df_columns_are_counted_from_the_right() {
        // (line, expected mount, expected avail kB, expected size kB)
        let cases: [(&str, &str, f64, Option<f64>); 3] = [
            (
                "/dev/nvme0n1p2 498008372 396520404 94948460 81% /",
                "/",
                94_948_460.0,
                Some(498_008_372.0),
            ),
            // The row that broke it: two words before the numbers.
            (
                "map auto_home 0 0 0 100% /System/Volumes/Data/home",
                "/System/Volumes/Data/home",
                0.0,
                Some(0.0),
            ),
            // And a device with a space in it, which is why indexing from the
            // left can never be right.
            (
                "//server/my share 1000 400 600 40% /mnt/share",
                "/mnt/share",
                600.0,
                Some(1000.0),
            ),
        ];
        for (line, mount, avail, size) in cases {
            let f: Vec<&str> = line.split_whitespace().collect();
            let n = f.len();
            assert_eq!(f[n - 1], mount, "mount for {line:?}");
            assert_eq!(
                f[n - 3].parse::<f64>().ok(),
                Some(avail),
                "avail for {line:?}"
            );
            assert_eq!(f[n - 5].parse::<f64>().ok(), size, "size for {line:?}");
        }
    }
}
