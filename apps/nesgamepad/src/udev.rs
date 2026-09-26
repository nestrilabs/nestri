//! Telling libudev about a device, in a box that has no udev.
//!
//! Games find controllers through libudev -- SDL, and Wine's device bus under
//! Proton, both enumerate with it and watch its monitor for hotplug. Without a
//! udev daemon the kernel still creates the device and its node, but two things
//! a daemon adds are missing, and each is enough on its own to make a
//! controller invisible:
//!
//! - **Properties.** Whether an input device is a joystick is not something
//!   the kernel says; `ID_INPUT_JOYSTICK` is the daemon's classification,
//!   stored in its database under `/run/udev/data`. Readers ask for it by name
//!   and skip a device that lacks it.
//! - **Hotplug.** libudev's monitor listens on the netlink group the *daemon*
//!   rebroadcasts on, not the one the kernel announces on, so a device created
//!   while a game is running is never seen by it.
//!
//! This does both, for the devices this process makes and nothing else.
//!
//! # What a broadcast must look like to be believed
//!
//! Taken from libudev's receiving side (systemd's `device-monitor.c`), because
//! every one of these is a silent drop on failure:
//!
//! - The monitor only listens without a daemon at all when `/dev` is a
//!   devtmpfs, which in a box it is.
//! - The sender must be uid 0. This process runs as root for that reason.
//! - A message with the `libudev` header marks the device initialized; one in
//!   the kernel's own `action@devpath` form does not, and readers that check
//!   drop it. The header carries MurmurHash2 hashes that subscribers filter on
//!   *in the kernel*, so a wrong hash is a message nobody receives.

use std::collections::BTreeMap;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

const DATA_DIR: &str = "/run/udev/data";
const TAGS_DIR: &str = "/run/udev/tags";

/// The netlink group udevd rebroadcasts on, as opposed to the kernel's 1.
const GROUP_UDEV: u32 = 2;
const UDEV_MONITOR_MAGIC: u32 = 0xfeed_cafe;

/// Tags every input device a seat owns gets from udev's stock rules. A reader
/// enumerating by tag, rather than by subsystem, finds nothing without them.
const TAGS: [&str; 2] = ["seat", "uaccess"];

/// systemd's `MurmurHash2`, seed and all. Its hashes go into a header the
/// kernel filters on, so this has to agree bit for bit.
fn murmur2(data: &[u8], seed: u32) -> u32 {
    const M: u32 = 0x5bd1_e995;
    let mut h = seed ^ data.len() as u32;
    let (chunks, tail) = data.as_chunks::<4>();
    for chunk in chunks {
        let mut k = u32::from_le_bytes(*chunk);
        k = k.wrapping_mul(M);
        k ^= k >> 24;
        k = k.wrapping_mul(M);
        h = h.wrapping_mul(M) ^ k;
    }
    if !tail.is_empty() {
        for (i, &b) in tail.iter().enumerate().rev() {
            h ^= u32::from(b) << (8 * i);
        }
        h = h.wrapping_mul(M);
    }
    h ^= h >> 13;
    h = h.wrapping_mul(M);
    h ^ (h >> 15)
}

fn bloom(tag: &str) -> u64 {
    let hash = murmur2(tag.as_bytes(), 0);
    [0, 6, 12, 18]
        .iter()
        .fold(0, |bits, shift| bits | 1u64 << ((hash >> shift) & 63))
}

/// One device as udev would describe it.
#[derive(Debug, Clone)]
pub struct Record {
    /// Path under `/sys`, which is what udev calls the devpath.
    pub devpath: String,
    /// The database's name for it: `c13:80` for a node, `+input:input5` for
    /// a device without one.
    pub db_name: String,
    pub properties: BTreeMap<String, String>,
}

impl Record {
    /// Describe a device from what the kernel says about it, plus what udev's
    /// rules would have added.
    ///
    /// The kernel's own `uevent` file is the base, because that is exactly
    /// what udevd starts from; `extra` is the classification on top.
    pub fn read(syspath: &Path, extra: &[(&str, String)]) -> io::Result<Self> {
        let mut properties = BTreeMap::new();
        for line in std::fs::read_to_string(syspath.join("uevent"))?.lines() {
            if let Some((key, value)) = line.split_once('=') {
                properties.insert(key.to_owned(), value.to_owned());
            }
        }
        let devpath = devpath(syspath)?;
        let sysname = syspath
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();

        let db_name = match (properties.get("MAJOR"), properties.get("MINOR")) {
            (Some(major), Some(minor)) => format!("c{major}:{minor}"),
            _ => format!("+input:{sysname}"),
        };
        // The kernel names the node relative to /dev; udev names it in full.
        if let Some(devname) = properties.get_mut("DEVNAME")
            && !devname.starts_with('/')
        {
            *devname = format!("/dev/{devname}");
        }
        properties.insert("DEVPATH".into(), devpath.clone());
        properties.insert("SUBSYSTEM".into(), "input".into());
        properties.insert("USEC_INITIALIZED".into(), monotonic_usec().to_string());
        let tags = format!(":{}:", TAGS.join(":"));
        properties.insert("TAGS".into(), tags.clone());
        properties.insert("CURRENT_TAGS".into(), tags);
        for (key, value) in extra {
            properties.insert((*key).to_owned(), value.clone());
        }
        Ok(Self {
            devpath,
            db_name,
            properties,
        })
    }

    /// The database entry, in the format udevd writes.
    fn db_entry(&self) -> String {
        let mut entry = format!("I:{}\n", self.properties["USEC_INITIALIZED"]);
        // Only what a rule added goes in the database; the rest a reader gets
        // from sysfs itself.
        for (key, value) in &self.properties {
            if key.starts_with("ID_") {
                entry.push_str(&format!("E:{key}={value}\n"));
            }
        }
        for tag in TAGS {
            entry.push_str(&format!("G:{tag}\nQ:{tag}\n"));
        }
        entry.push_str("V:1\n");
        entry
    }
}

/// udev's devpath: the syspath without `/sys`, keeping the leading slash.
///
/// `Path::strip_prefix` drops that slash, and libudev joins `/sys` straight
/// onto whatever it is given -- so without it every device lands at
/// `/sysdevices/...`, and every broadcast is rejected with nothing logged.
fn devpath(syspath: &Path) -> io::Result<String> {
    let rest = syspath
        .strip_prefix("/sys")
        .map_err(|_| io::Error::other("not under /sys"))?;
    Ok(format!("/{}", rest.to_string_lossy()))
}

fn monotonic_usec() -> u64 {
    let mut ts = libc::timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };
    // SAFETY: a valid clock and a timespec to fill.
    unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, &mut ts) };
    ts.tv_sec as u64 * 1_000_000 + ts.tv_nsec as u64 / 1_000
}

/// Stands in for udevd's database and broadcasts.
pub struct Udev {
    socket: std::os::fd::OwnedFd,
    seqnum: AtomicU64,
}

impl Udev {
    pub fn new() -> io::Result<Self> {
        let udev = Self::broadcaster()?;
        for dir in [PathBuf::from(DATA_DIR)]
            .into_iter()
            .chain(TAGS.iter().map(|t| Path::new(TAGS_DIR).join(t)))
        {
            std::fs::create_dir_all(&dir)?;
        }
        Ok(udev)
    }

    /// The broadcasting half alone, which touches nothing on disk.
    fn broadcaster() -> io::Result<Self> {
        // SAFETY: plain socket creation; the result is checked.
        let fd = unsafe {
            libc::socket(
                libc::AF_NETLINK,
                libc::SOCK_RAW | libc::SOCK_CLOEXEC,
                libc::NETLINK_KOBJECT_UEVENT,
            )
        };
        if fd < 0 {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: a descriptor just returned to us and owned by nothing else.
        let socket = unsafe { std::os::fd::FromRawFd::from_raw_fd(fd) };
        Ok(Self {
            socket,
            seqnum: AtomicU64::new(1),
        })
    }

    /// Record a device and announce it.
    pub fn add(&self, record: &Record) -> io::Result<()> {
        std::fs::write(Path::new(DATA_DIR).join(&record.db_name), record.db_entry())?;
        for tag in TAGS {
            std::fs::write(Path::new(TAGS_DIR).join(tag).join(&record.db_name), "")?;
        }
        self.broadcast("add", record)
    }

    /// Announce a device gone and forget it. Every step is attempted even if
    /// an earlier one fails: a stale database entry is harmless next to a
    /// removal nobody heard.
    pub fn remove(&self, record: &Record) -> io::Result<()> {
        let _ = std::fs::remove_file(Path::new(DATA_DIR).join(&record.db_name));
        for tag in TAGS {
            let _ = std::fs::remove_file(Path::new(TAGS_DIR).join(tag).join(&record.db_name));
        }
        self.broadcast("remove", record)
    }

    fn broadcast(&self, action: &str, record: &Record) -> io::Result<()> {
        let seqnum = self.seqnum.fetch_add(1, Ordering::Relaxed);
        let message = encode(action, seqnum, record);
        let mut addr: libc::sockaddr_nl = unsafe { std::mem::zeroed() };
        addr.nl_family = libc::AF_NETLINK as u16;
        addr.nl_groups = GROUP_UDEV;
        // SAFETY: the address and buffer outlive the call.
        let n = unsafe {
            libc::sendto(
                std::os::fd::AsRawFd::as_raw_fd(&self.socket),
                message.as_ptr().cast(),
                message.len(),
                0,
                (&addr as *const libc::sockaddr_nl).cast(),
                std::mem::size_of::<libc::sockaddr_nl>() as u32,
            )
        };
        if n < 0 {
            let error = io::Error::last_os_error();
            // What a multicast send reports when nobody is listening yet,
            // which before a game has started is the normal case.
            if error.raw_os_error() == Some(libc::ECONNREFUSED) {
                return Ok(());
            }
            return Err(error);
        }
        Ok(())
    }
}

/// A libudev monitor message: the `monitor_netlink_header`, then the
/// properties as NUL-terminated `KEY=value` strings.
fn encode(action: &str, seqnum: u64, record: &Record) -> Vec<u8> {
    let mut properties = Vec::new();
    let mut push = |key: &str, value: &str| {
        properties.extend_from_slice(key.as_bytes());
        properties.push(b'=');
        properties.extend_from_slice(value.as_bytes());
        properties.push(0);
    };
    push("ACTION", action);
    push("SEQNUM", &seqnum.to_string());
    for (key, value) in &record.properties {
        push(key, value);
    }

    const HEADER_LEN: u32 = 40;
    let tags = TAGS.iter().fold(0u64, |bits, tag| bits | bloom(tag));
    let mut message = Vec::with_capacity(HEADER_LEN as usize + properties.len());
    message.extend_from_slice(b"libudev\0");
    // The magic, hashes and bloom are in network order; the lengths are not.
    message.extend_from_slice(&UDEV_MONITOR_MAGIC.to_be_bytes());
    message.extend_from_slice(&HEADER_LEN.to_ne_bytes());
    message.extend_from_slice(&HEADER_LEN.to_ne_bytes());
    message.extend_from_slice(&(properties.len() as u32).to_ne_bytes());
    message.extend_from_slice(&murmur2(b"input", 0).to_be_bytes());
    // Input devices have no devtype, and zero is what udevd sends for none.
    message.extend_from_slice(&0u32.to_be_bytes());
    message.extend_from_slice(&((tags >> 32) as u32).to_be_bytes());
    message.extend_from_slice(&(tags as u32).to_be_bytes());
    debug_assert_eq!(message.len(), HEADER_LEN as usize);
    message.extend_from_slice(&properties);
    message
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_devpath_starts_where_sys_ends() {
        assert_eq!(
            devpath(Path::new("/sys/devices/virtual/input/input5/event3")).unwrap(),
            "/devices/virtual/input/input5/event3"
        );
        assert!(devpath(Path::new("/dev/input/event3")).is_err());
    }

    #[test]
    fn hashes_agree_with_systemd() {
        // Computed by compiling systemd's own MurmurHash2.c.
        for (input, expected) in [
            ("input", 0xc1a2_8470),
            ("seat", 0x435b_3e40),
            ("uaccess", 0xe88e_d0cc),
            ("hidraw", 0xc2ca_f397),
            ("a", 0x9268_5f5e),
            ("ab", 0x1aa1_4063),
            ("abc", 0x1357_7c9b),
        ] {
            assert_eq!(murmur2(input.as_bytes(), 0), expected, "{input}");
        }
    }

    fn record() -> Record {
        let mut properties = BTreeMap::new();
        properties.insert(
            "DEVPATH".into(),
            "/devices/virtual/input/input5/event3".into(),
        );
        properties.insert("SUBSYSTEM".into(), "input".into());
        properties.insert("USEC_INITIALIZED".into(), "42".into());
        properties.insert("ID_INPUT_JOYSTICK".into(), "1".into());
        properties.insert("NAME".into(), "\"x\"".into());
        properties.insert("TAGS".into(), ":seat:uaccess:".into());
        Record {
            devpath: "/devices/virtual/input/input5/event3".into(),
            db_name: "c13:67".into(),
            properties,
        }
    }

    #[test]
    fn a_broadcast_has_the_header_libudev_checks() {
        let message = encode("add", 7, &record());
        assert_eq!(&message[..8], b"libudev\0");
        assert_eq!(&message[8..12], &[0xfe, 0xed, 0xca, 0xfe]);
        let off = u32::from_ne_bytes(message[16..20].try_into().unwrap()) as usize;
        let len = u32::from_ne_bytes(message[20..24].try_into().unwrap()) as usize;
        assert_eq!(off + len, message.len());
        assert_eq!(&message[24..28], &0xc1a2_8470u32.to_be_bytes());
        let props: Vec<&[u8]> = message[off..].split(|&b| b == 0).collect();
        for needed in [&b"ACTION=add"[..], b"SEQNUM=7", b"SUBSYSTEM=input"] {
            assert!(
                props.contains(&needed),
                "{}",
                String::from_utf8_lossy(needed)
            );
        }
    }

    /// The broadcast as real libudev receives it. Needs uid 0 and its own
    /// network namespace, both of which `unshare -rn` gives without root, and
    /// a libudev monitor listening in that namespace to report what it got.
    #[test]
    #[ignore = "sends a real udev broadcast; run inside `unshare -rn` beside a monitor"]
    fn a_broadcast_for_a_monitor() {
        Udev::broadcaster()
            .unwrap()
            .broadcast("add", &record())
            .unwrap();
    }

    #[test]
    fn the_database_holds_the_classification_and_the_tags() {
        let entry = record().db_entry();
        assert!(entry.starts_with("I:42\n"));
        assert!(entry.contains("E:ID_INPUT_JOYSTICK=1\n"));
        assert!(!entry.contains("NAME"));
        assert!(entry.contains("G:seat\n") && entry.contains("Q:uaccess\n"));
        assert!(entry.ends_with("V:1\n"));
    }
}
