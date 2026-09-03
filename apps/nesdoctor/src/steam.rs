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
//! # The third one is biased, and this is the shape of the bias
//!
//! This module used to claim that a library of eighty games is *"eighty samples
//! of what hour this person launches a game at — a real distribution"*. **It is
//! not.** Steam keeps one `LastPlayed` per title, so what the histogram holds is
//! one sample per *title*, at the hour that title was last closed, over the
//! whole life of the library. Three things follow, and all three push the same
//! way:
//!
//! - **A title played once, years ago, weighs exactly as much as a daily
//!   driver.** Measured on one dev machine: eight titles, eight samples,
//!   spanning back to 2025-09-04.
//! - **A daily driver contributes one sample, ever**, at whatever hour it
//!   happened to be closed last. Five hundred hours of play, one point.
//! - **So the metric over-weights trying and under-weights playing.** An
//!   afternoon spent installing and sampling a dozen games stamps a dozen
//!   titles with that afternoon's hour; every one of them outvotes the game
//!   somebody actually plays every evening. On the production host this reads
//!   `n=331` with **329 titles no longer installed** — a histogram that is
//!   mostly the archaeology of a library, presented as current behaviour.
//!
//! The direction is knowable, so it is corrected rather than disclaimed. Two
//! histograms are reported: the whole library, as before, and **titles played
//! within [`RECENT_DAYS`]**, which is one sample per title still in use and is
//! the one the peak window prefers when it has the samples for it. Which one
//! the peak came from is stated in the output and on the wire (`peaksrc=`),
//! because a corpus that cannot tell them apart is a corpus that will mix them.
//!
//! What no local file supports is weighting a sample by how much a title is
//! played: `Playtime` is a lifetime total against a single timestamp, so
//! weighting by it would multiply one arbitrary hour by five hundred. It is
//! read and reported, and it is not used as a weight.
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
use std::time::{SystemTime, UNIX_EPOCH};

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
    /// Count of `LastPlayed` timestamps falling in each local hour, 0–23, one
    /// per title across the whole library. See the module header: this is a
    /// per-*title* sample, not a per-launch one.
    pub last_played_hours: [u32; 24],
    /// Titles with a usable `LastPlayed`. **Not a launch count** — it was
    /// reported as one until 2026-09-03 and it never was.
    pub titles_sampled: usize,
    /// The same histogram restricted to titles played within [`RECENT_DAYS`].
    /// One sample per title still in use, which is the closest this data gets
    /// to current behaviour.
    pub recent_hours: [u32; 24],
    pub recent_samples: usize,
    /// Lifetime `Playtime`, in minutes, summed over sampled titles. Reported
    /// for scale; deliberately *not* used to weight the histogram.
    pub playtime_minutes: u64,
    /// How far back the whole-library histogram reaches, in days. A histogram
    /// spanning two years is a different object from one spanning a month.
    pub sample_span_days: Option<u32>,
    /// How many Steam user profiles were found on this machine. More than one
    /// means more than one person may use it, and the histogram is taken from
    /// the busiest profile rather than summed across strangers.
    pub profiles: usize,
    /// Sampled titles that are not installed any more. Kept in the whole-library
    /// histogram on purpose — someone did play them once — and reported so `n`
    /// cannot be mistaken for the installed-title count. When this dwarfs
    /// `titles`, the whole-library histogram is mostly history.
    pub sampled_uninstalled: usize,
    /// Hours covering half the samples, contiguous and wrapping — the "evening
    /// peak" if there is one. Taken from [`Self::recent_hours`] when that has
    /// enough samples to claim a shape, and from the whole library otherwise.
    pub peak_window: Option<(u32, u32)>,
    /// Which histogram [`Self::peak_window`] came from: `"30d"` or `"all"`.
    /// Never infer it from the sample counts; read it here.
    pub peak_source: Option<&'static str>,
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

    // Canonicalise before deduplicating. `~/.steam/steam` is conventionally a
    // symlink to `~/.local/share/Steam`, so both candidates hit and every
    // profile is found twice -- measured on the development machine, which
    // reported four Steam profiles for two real ones and would have claimed a
    // shared machine where there is not one.
    let mut out: Vec<PathBuf> = v
        .into_iter()
        .filter(|p| p.join("steamapps").is_dir())
        .map(|p| fs::canonicalize(&p).unwrap_or(p))
        .collect();
    out.sort();
    out.dedup();
    out
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
    // appid -> (title, is_runtime). Needed by the launch histogram below, which
    // sees appids and nothing else.
    let mut known: BTreeMap<String, (String, bool)> = BTreeMap::new();
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
            if let Some(id) = doc
                .get(&["AppState", "appid"])
                .and_then(vdf::Value::as_str)
                .map(str::to_string)
            {
                known.insert(id, (title.clone(), is_runtime(&title)));
            }
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
    //
    // `localconfig.vdf` keeps a `LastPlayed` per app, which makes a library of
    // eighty games eighty samples of what hour this person starts playing.
    // Two things have to be handled or the number is wrong:
    //
    // **Runtimes are not launches.** Proton and the Steam Linux Runtimes carry
    // `LastPlayed` like any app, and Steam starts them itself, at whatever hour
    // it happens to update them. They are filtered here by joining the appid
    // against the installed-title names — the same filter the title count uses,
    // so the two cannot disagree about what a game is.
    //
    // **Profiles are not one person.** A shared machine has several, and
    // summing them produces a histogram of nobody. The busiest profile is used
    // and the count is reported, so a two-profile machine is visible as one.
    let mut per_profile: Vec<ProfileSample> = Vec::new();

    // Wall clock, once. If it is unavailable the recent subset stays empty and
    // the peak falls back to the whole library, labelled `all` — degraded, and
    // never silently mislabelled.
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_secs());
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

            let mut p = ProfileSample::default();
            for (appid, app) in apps {
                let Some(ts) = app.get(&["LastPlayed"]).and_then(vdf::Value::as_u64) else {
                    continue;
                };
                if ts == 0 {
                    continue;
                }
                match known.get(appid) {
                    // A tool Steam launched, not a person playing.
                    Some((_, true)) => continue,
                    Some((_, false)) => {}
                    // Not installed now. Someone did play it once, so it stays
                    // in the whole-library histogram — but it is counted
                    // separately, because a large count here is the signal that
                    // that histogram is history rather than behaviour.
                    None => p.gone += 1,
                }
                let Some(h) = local_hour(ts) else { continue };
                p.hours[h as usize] += 1;
                p.n += 1;
                p.playtime += app
                    .get(&["Playtime"])
                    .and_then(vdf::Value::as_u64)
                    .unwrap_or(0);
                p.oldest = Some(p.oldest.map_or(ts, |o: u64| o.min(ts)));
                // Recent means "still in use". Age is taken from the timestamp
                // itself rather than from `Playtime2wks`, which is absent on
                // most entries and so would silently shrink the subset.
                if now.is_some_and(|now| now.saturating_sub(ts) <= RECENT_DAYS * 86_400) {
                    p.recent_hours[h as usize] += 1;
                    p.recent_n += 1;
                }
            }
            if p.n > 0 {
                per_profile.push(p);
            }
        }
    }

    r.profiles = per_profile.len();
    if let Some(p) = per_profile.into_iter().max_by_key(|p| p.n) {
        r.last_played_hours = p.hours;
        r.titles_sampled = p.n;
        r.sampled_uninstalled = p.gone;
        r.recent_hours = p.recent_hours;
        r.recent_samples = p.recent_n;
        r.playtime_minutes = p.playtime;
        r.sample_span_days = match (now, p.oldest) {
            (Some(now), Some(oldest)) => Some((now.saturating_sub(oldest) / 86_400) as u32),
            _ => None,
        };
    }

    (r.peak_window, r.peak_source) = choose_peak(
        (&r.recent_hours, r.recent_samples),
        (&r.last_played_hours, r.titles_sampled),
    );
    r
}

/// Prefer the subset that describes current behaviour, and say which was used.
///
/// Falling back to the whole library is better than reporting nothing, but the
/// two answer different questions — *when does this person play* against *when
/// was this library touched, ever* — so a window must never arrive unlabelled.
fn choose_peak(
    recent: (&[u32; 24], usize),
    all: (&[u32; 24], usize),
) -> (Option<(u32, u32)>, Option<&'static str>) {
    if let Some(w) = peak_window(recent.0, recent.1) {
        return (Some(w), Some("30d"));
    }
    match peak_window(all.0, all.1) {
        Some(w) => (Some(w), Some("all")),
        None => (None, None),
    }
}

/// How recent a `LastPlayed` has to be for its title to count as still in use.
///
/// Thirty days rather than Steam's own two-week `Playtime2wks`: two weeks is
/// below [`MIN_SAMPLES`] for most libraries, and a subset too small to claim a
/// shape is a subset that silently falls back to the biased histogram.
const RECENT_DAYS: u64 = 30;

/// One profile's tally, before the busiest is chosen.
#[derive(Default)]
struct ProfileSample {
    hours: [u32; 24],
    n: usize,
    gone: usize,
    recent_hours: [u32; 24],
    recent_n: usize,
    playtime: u64,
    oldest: Option<u64>,
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

/// Fewer samples than this cannot claim a shape, so no peak is reported.
pub const MIN_SAMPLES: usize = 8;

/// The shortest contiguous, wrapping run of hours holding at least half the
/// samples. That is the honest form of "when do you play": if it is four hours
/// wide there is an evening peak, and if it takes fourteen there is not.
fn peak_window(hours: &[u32; 24], total: usize) -> Option<(u32, u32)> {
    if total < MIN_SAMPLES {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn hist(pairs: &[(usize, u32)]) -> ([u32; 24], usize) {
        let mut h = [0u32; 24];
        for &(hour, n) in pairs {
            h[hour] += n;
        }
        (h, h.iter().sum::<u32>() as usize)
    }

    #[test]
    fn the_recent_subset_wins_when_it_can_claim_a_shape() {
        // 8 samples, half is 4, and no single hour holds 4 — so the window is
        // genuinely two hours wide and not an artefact of one tall bar.
        let (recent, rn) = hist(&[(22, 3), (23, 3), (2, 2)]);
        let (all, an) = hist(&[(14, 200), (22, 3), (23, 3), (2, 2)]);
        let (w, src) = choose_peak((&recent, rn), (&all, an));
        assert_eq!(src, Some("30d"));
        assert_eq!(w, Some((22, 23)));
    }

    #[test]
    fn a_thin_recent_subset_falls_back_and_says_so() {
        // Three titles this month cannot outvote a library; the point is that
        // the fallback is *labelled*, not that it is avoided.
        let (recent, rn) = hist(&[(22, 3)]);
        let (all, an) = hist(&[(14, 40)]);
        let (w, src) = choose_peak((&recent, rn), (&all, an));
        assert_eq!(src, Some("all"));
        assert_eq!(w, Some((14, 14)));
    }

    #[test]
    fn no_samples_means_no_window_and_no_source() {
        let empty = [0u32; 24];
        assert_eq!(choose_peak((&empty, 0), (&empty, 0)), (None, None));
    }

    #[test]
    fn a_peak_is_never_claimed_from_too_few_samples() {
        let (h, n) = hist(&[(20, (MIN_SAMPLES - 1) as u32)]);
        assert_eq!(peak_window(&h, n), None);
        let (h, n) = hist(&[(20, MIN_SAMPLES as u32)]);
        assert_eq!(peak_window(&h, n), Some((20, 20)));
    }

    #[test]
    fn the_window_is_the_shortest_wrapping_run_holding_half() {
        // Straddling midnight is the case a non-wrapping scan gets wrong, and
        // it is exactly the evening peak the demand question is about.
        // ref(d-0017)
        let (h, n) = hist(&[(23, 6), (0, 6), (12, 1), (13, 1)]);
        assert_eq!(peak_window(&h, n), Some((23, 0)));
    }
}
