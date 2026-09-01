//! What Steam already knows, read locally and only with permission.
//!
//! Three things we would otherwise have to ask about are answerable from files
//! on disk, and all three are ones people answer badly when asked:
//!
//! | question | what we read |
//! |---|---|
//! | *what do you play?* | `appmanifest_*.acf` — title and size on disk |
//! | *how big is a library?* | the sum of those sizes, which is the content store's cost |
//! | *when do you play?* | `localconfig.vdf` — `LastPlayed` per title, as an hour-of-day histogram |
//!
//! The third is the interesting one. Steam keeps one `LastPlayed` timestamp per
//! title, so a library of eighty games is **eighty samples of what hour this
//! person launches a game at** — a real distribution, taken without asking, and
//! the thing a demand trough is made of. It is biased toward whatever
//! they played most recently and it is not a schedule; it is a sample, and it is
//! reported as one.
//!
//! # This is somebody's private library
//!
//! Nothing here runs without an explicit yes, nothing leaves the machine, and
//! the summary line carries **counts and hours, never titles**. The full JSON
//! stays in a local file the caller is told the path of. Reading a game library
//! is not a neutral act and the code is arranged so that a reader can confirm
//! that in one pass.

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use serde::Serialize;

use crate::vdf;

#[derive(Debug, Serialize, Default)]
pub struct SteamReport {
    pub found: bool,
    pub roots: Vec<String>,
    pub titles: usize,
    pub bytes_on_disk: u64,
    /// The five largest, by size on disk. Included because library *shape* is
    /// what decides whether a depot cache has a head to cache.
    pub largest: Vec<(String, u64)>,
    /// Count of `LastPlayed` timestamps falling in each local hour, 0–23.
    pub launch_hours: [u32; 24],
    pub launch_samples: usize,
    /// Hours covering half of all launches, contiguous and wrapping — the
    /// "evening peak" if there is one.
    pub peak_window: Option<(u32, u32)>,
}

/// Proton builds, runtimes and redistributables are installed like games and
/// are not games.
///
/// Measured 2026-09-02: on a machine with one real title, five of the eight
/// entries were runtimes — so counting them inflates the title count by 5x and
/// corrupts the library-shape question this is here to answer. Matching on the
/// name is imperfect and is the honest trade: a title genuinely called
/// "Proton …" would be dropped, and no real title is.
fn is_runtime(title: &str) -> bool {
    const PREFIXES: [&str; 5] = [
        "Proton",
        "Steam Linux Runtime",
        "Steamworks Common Redistributables",
        "Steam Deck",
        "SteamVR",
    ];
    PREFIXES.iter().any(|p| title.starts_with(p))
}

/// Where Steam might be. Checked in order; all hits are used, because a library
/// is routinely split across drives.
fn candidate_roots() -> Vec<PathBuf> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from);
    let mut v = Vec::new();
    if let Some(h) = home {
        v.push(h.join(".steam/steam"));
        v.push(h.join(".local/share/Steam"));
        // Flatpak keeps its own home.
        v.push(h.join(".var/app/com.valvesoftware.Steam/.local/share/Steam"));
        v.push(h.join("Library/Application Support/Steam")); // macOS
    }
    v.push(PathBuf::from(r"C:\Program Files (x86)\Steam"));
    v.push(PathBuf::from("/usr/lib/steam"));
    v.into_iter()
        .filter(|p| p.join("steamapps").is_dir())
        .collect()
}

/// True when there is anything to ask about. Called *before* consent so the
/// question is not asked of someone with no Steam install.
pub fn present() -> bool {
    !candidate_roots().is_empty()
}

pub fn read() -> SteamReport {
    let roots = candidate_roots();
    if roots.is_empty() {
        return SteamReport::default();
    }

    let mut r = SteamReport {
        found: true,
        roots: roots.iter().map(|p| p.display().to_string()).collect(),
        ..Default::default()
    };

    // Library folders can live on other drives; `libraryfolders.vdf` lists
    // them, and skipping it undercounts a split library badly.
    let mut app_dirs: Vec<PathBuf> = roots.iter().map(|p| p.join("steamapps")).collect();
    for root in &roots {
        let lf = root.join("steamapps/libraryfolders.vdf");
        if let Ok(txt) = fs::read_to_string(&lf) {
            let doc = vdf::parse(&txt);
            if let Some(folders) = doc.get(&["libraryfolders"]).and_then(vdf::Value::as_node) {
                for entry in folders.values() {
                    if let Some(p) = entry.get(&["path"]).and_then(vdf::Value::as_str) {
                        let d = PathBuf::from(p).join("steamapps");
                        if d.is_dir() {
                            app_dirs.push(d);
                        }
                    }
                }
            }
        }
    }
    app_dirs.sort();
    app_dirs.dedup();

    let mut by_size: Vec<(String, u64)> = Vec::new();
    for dir in &app_dirs {
        let Ok(entries) = fs::read_dir(dir) else {
            continue;
        };
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            if !(name.starts_with("appmanifest_") && name.ends_with(".acf")) {
                continue;
            }
            let Ok(txt) = fs::read_to_string(e.path()) else {
                continue;
            };
            let doc = vdf::parse(&txt);
            let title = doc
                .get(&["AppState", "name"])
                .and_then(vdf::Value::as_str)
                .unwrap_or("unknown")
                .to_string();
            let size = doc
                .get(&["AppState", "SizeOnDisk"])
                .and_then(vdf::Value::as_u64)
                .unwrap_or(0);
            if is_runtime(&title) {
                continue;
            }
            by_size.push((title, size));
        }
    }
    // A split library can list the same appid twice; dedupe by title.
    by_size.sort_by(|a, b| a.0.cmp(&b.0));
    by_size.dedup_by(|a, b| a.0 == b.0);

    r.titles = by_size.len();
    r.bytes_on_disk = by_size.iter().map(|(_, s)| s).sum();
    by_size.sort_by_key(|(_, size)| std::cmp::Reverse(*size));
    r.largest = by_size.into_iter().take(5).collect();

    // --- when do they play -----------------------------------------------
    for root in &roots {
        let Ok(users) = fs::read_dir(root.join("userdata")) else {
            continue;
        };
        for u in users.flatten() {
            let cfg = u.path().join("config/localconfig.vdf");
            let Ok(txt) = fs::read_to_string(&cfg) else {
                continue;
            };
            let doc = vdf::parse(&txt);
            let Some(apps) = doc
                .get(&["UserLocalConfigStore", "Software", "Valve", "Steam", "apps"])
                .and_then(vdf::Value::as_node)
            else {
                continue;
            };
            for app in apps.values() {
                let Some(ts) = app.get(&["LastPlayed"]).and_then(vdf::Value::as_u64) else {
                    continue;
                };
                if ts == 0 {
                    continue;
                }
                if let Some(h) = local_hour(ts) {
                    r.launch_hours[h as usize] += 1;
                    r.launch_samples += 1;
                }
            }
        }
    }
    r.peak_window = peak_window(&r.launch_hours, r.launch_samples);
    r
}

/// Hour of day, in the machine's local time, for a Unix timestamp.
///
/// Done with the offset the OS reports rather than a timezone crate: we need
/// the hour a person launched a game in their own reckoning, and one integer
/// offset is enough for that. DST at the boundary shifts a sample by an hour,
/// which is inside the resolution this is reported at.
fn local_hour(unix: u64) -> Option<u32> {
    let offset = utc_offset_seconds()?;
    let local = unix as i64 + offset;
    Some((local.rem_euclid(86_400) / 3600) as u32)
}

fn utc_offset_seconds() -> Option<i64> {
    // `date +%z` gives `+0200`. Present on every unix; PowerShell for Windows.
    let z = crate::sys::sh("date", &["+%z"]).or_else(|| {
        crate::sys::ps("(Get-TimeZone).BaseUtcOffset.TotalSeconds")
            .and_then(|s| s.trim().parse::<f64>().ok())
            .map(|s| format!("{:+05}", (s as i64 / 3600) * 100))
    })?;
    let z = z.trim();
    let sign = if z.starts_with('-') { -1 } else { 1 };
    let digits: String = z.chars().filter(char::is_ascii_digit).collect();
    if digits.len() < 4 {
        return None;
    }
    let h: i64 = digits[0..2].parse().ok()?;
    let m: i64 = digits[2..4].parse().ok()?;
    Some(sign * (h * 3600 + m * 60))
}

/// The shortest contiguous, wrapping run of hours holding at least half the
/// launches. That is the honest form of "when do you play": if it is four hours
/// wide there is an evening peak, and if it takes fourteen there is not.
fn peak_window(hours: &[u32; 24], total: usize) -> Option<(u32, u32)> {
    if total < 8 {
        return None; // too few samples to claim a shape
    }
    let half = (total as f64 / 2.0).ceil() as u32;
    let mut best: Option<(u32, u32, u32)> = None; // width, start, end
    for start in 0..24u32 {
        let mut sum = 0;
        for w in 1..=24u32 {
            sum += hours[((start + w - 1) % 24) as usize];
            if sum >= half {
                let cand = (w, start, (start + w - 1) % 24);
                if best.is_none_or(|b| w < b.0) {
                    best = Some(cand);
                }
                break;
            }
        }
    }
    best.map(|(_, s, e)| (s, e))
}

/// GiB, for display.
pub fn gib(bytes: u64) -> f64 {
    bytes as f64 / 1_073_741_824.0
}

/// A one-line sparkline of the launch-hour histogram.
///
/// Worth the twenty lines: it is the part of the output people screenshot, and
/// it is the only place someone sees their own play schedule as a shape.
pub fn sparkline(hours: &[u32; 24]) -> String {
    const BARS: [char; 8] = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
    let max = *hours.iter().max().unwrap_or(&0);
    if max == 0 {
        return String::new();
    }
    hours
        .iter()
        .map(|&h| {
            if h == 0 {
                ' '
            } else {
                BARS[((h as f64 / max as f64) * 7.0).round() as usize]
            }
        })
        .collect()
}

/// Titles are never put in the paste line, so this is what goes instead:
/// a coarse size band, which is all a content-store estimate needs.
pub fn size_band(bytes: u64) -> &'static str {
    match gib(bytes) {
        g if g < 100.0 => "<100G",
        g if g < 500.0 => "100-500G",
        g if g < 1500.0 => "0.5-1.5T",
        _ => ">1.5T",
    }
}

#[allow(dead_code)]
pub fn debug_map(_m: &BTreeMap<String, vdf::Value>) {}
