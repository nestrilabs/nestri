//! The verdict, the printed report, and the one line somebody pastes.
//!
//! Two audiences and they want different things. The person running this wants
//! to know whether their machine is any good and what to fix. We want the
//! distribution. The summary line is the only thing that crosses over, and it
//! is built to be legible to both: a human can read it, and it parses.
//!
//! # What is not in the line
//!
//! No IP address, no hostname, no username, no game titles, no file paths, no
//! machine identifier of any kind. A size *band* rather than a size, and an
//! hour histogram rather than timestamps. The full JSON — which does contain
//! titles and paths — stays on the local disk, and the person is told where.
//!
//! That is not politeness. A line that people are comfortable pasting in public
//! is a line that gets pasted, and one that quietly carries their hostname gets
//! screenshotted once and then never again.

use serde::Serialize;

use crate::ask::Answers;
use crate::hostreq::{HostReport, State};
use crate::net::NetReport;
use crate::steam::{self, SteamReport};
use crate::sys::SysInfo;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Serialize)]
pub struct Full<'a> {
    pub nesdoctor: &'static str,
    pub sys: &'a SysInfo,
    pub host: &'a HostReport,
    pub net: &'a NetReport,
    pub steam: &'a SteamReport,
    pub answers: &'a Answers,
    pub verdict: Verdict,
    pub region_hint: Option<String>,
}

/// What this machine is, in one word, plus why.
#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Verdict {
    /// Passes every blocking host check, and the uplink is good enough.
    HostReady,
    /// Hardware and software are fine; the network is the problem.
    HostBlockedByNetwork,
    /// Every check passes, the uplink is clean — and the machine is a long way
    /// from the rest of the internet, so it can only usefully serve players
    /// near it. Which is the most interesting result this tool produces.
    HostReadyLocalOnly,
    /// Could host with setup work — nothing missing that cannot be installed.
    HostFixable,
    /// Cannot host. Usually the GPU vendor or the OS.
    ClientOnly,
    Unknown,
}

impl Verdict {
    pub fn tag(self) -> &'static str {
        match self {
            Verdict::HostReady => "HOST-READY",
            Verdict::HostReadyLocalOnly => "HOST-READY-LOCAL",
            Verdict::HostBlockedByNetwork => "HOST-NET",
            Verdict::HostFixable => "HOST-FIXABLE",
            Verdict::ClientOnly => "CLIENT",
            Verdict::Unknown => "UNKNOWN",
        }
    }
}

/// The uplink thresholds a host has to clear.
///
/// Both matter and the second matters more: 1080p60 needs 10–15 Mbps, and
/// almost every fibre peer clears that, but added latency under load is what
/// actually disqualifies a machine. See `net::grade`.
const MIN_UP_MBPS: f64 = 15.0;
const MAX_BLOAT_MS: f64 = 30.0;

/// Idle round trip to the nearest anycast edge, above which this machine can
/// only serve players close to it.
///
/// This is a *floor* on what any player will see, not a measure of the machine.
/// The network allowance is ~40 ms in total, so a host already spending 178 ms
/// to reach Cloudflare's nearest point of presence cannot serve anyone who is
/// not on roughly its own local networks — and no upgrade changes that, because
/// it is distance.
///
/// Measured on the development connection 2026-09-02: 178 ms idle, served from
/// Johannesburg. That machine passes every other check and still cannot host
/// for a European player — which is the coverage argument seen from the other
/// end: the places with no nearby edge are the places a local host is the only
/// option anyone has.
const FAR_RTT_MS: f64 = 60.0;

pub fn verdict(sys: &SysInfo, host: &HostReport, net: &NetReport) -> Verdict {
    // A machine that cannot host is a client, and that is a complete answer —
    // not a failure. Most respondents will land here and the wording matters.
    if !host.could_host {
        // Distinguish "wrong hardware" from "missing setup": an AMD or Intel
        // card with a render node and KVM is a fixable machine.
        let fixable = sys.os == "linux"
            && host
                .checks
                .iter()
                .filter(|c| c.blocking && c.state == State::Fail)
                .all(|c| c.id == "vkvideo");
        return if fixable {
            Verdict::HostFixable
        } else {
            Verdict::ClientOnly
        };
    }
    if host.unknowns > 0 {
        return Verdict::Unknown;
    }
    match (net.upstream_mbps, net.bloat_ms) {
        (Some(up), Some(bloat)) => {
            if up < MIN_UP_MBPS || bloat > MAX_BLOAT_MS {
                Verdict::HostBlockedByNetwork
            // Deliberately the *median* and not the floor. Bloat asks "how much
            // queueing is added", so its baseline is the best the path can do.
            // This asks "what will a player actually see", so it takes the
            // typical case -- and on a link whose idle latency is bimodal
            // between 56 ms and 180 ms, the floor would call it near when half
            // of all connections are not.
            } else if net
                .idle_rtt_p50_ms
                .or(net.idle_rtt_ms)
                .is_some_and(|r| r > FAR_RTT_MS)
            {
                Verdict::HostReadyLocalOnly
            } else {
                Verdict::HostReady
            }
        }
        _ => Verdict::Unknown,
    }
}

/// The line to paste. Pipe-separated fields, `k=v` inside, stable key order.
/// Both renderers take the assembled report rather than seven arguments: the
/// set of things they need is exactly [`Full`], and keeping them in step with
/// it is the point.
pub fn summary_line(f_: &Full) -> String {
    let (sys, host, net, steam, answers, verdict, region) = (
        f_.sys,
        f_.host,
        f_.net,
        f_.steam,
        f_.answers,
        f_.verdict,
        &f_.region_hint,
    );
    let mut f: Vec<String> = Vec::new();
    f.push(format!("nesdoctor {VERSION}"));
    f.push(format!("{}/{}", sys.os, sys.arch));

    let gpu = sys
        .gpus
        .iter()
        .find(|g| g.render_node.is_some())
        .or_else(|| sys.gpus.first());
    f.push(format!(
        "gpu={}",
        gpu.map(|g| g.name.as_str()).unwrap_or("unknown")
    ));

    if let Some(r) = sys.ram_gib {
        f.push(format!("cpu={}t ram={r:.0}G", sys.cpu_threads));
    }

    if sys.os == "linux" {
        let st = |id: &str| {
            host.checks
                .iter()
                .find(|c| c.id == id)
                .map(|c| match c.state {
                    State::Pass => "y",
                    State::Fail => "n",
                    State::Unknown => "?",
                })
                .unwrap_or("-")
        };
        f.push(format!(
            "kvm={} venc={} zfs={} boxfs={} io={}",
            st("kvm"),
            st("vkvideo"),
            st("content-store"),
            st("box-store"),
            st("cgroup-io")
        ));
    }

    match (net.upstream_mbps, net.bloat_ms, net.grade) {
        (Some(up), Some(b), Some(g)) => f.push(format!(
            "up={up:.0}Mbps rtt={}/{}ms bloat=+{b:.0}ms grade={g}",
            net.idle_rtt_ms.map_or("?".into(), |r| format!("{r:.0}")),
            net.idle_rtt_p50_ms
                .map_or("?".into(), |r| format!("{r:.0}"))
        )),
        _ => f.push("net=unmeasured".into()),
    }

    if let Some(d) = sys.disks.first() {
        f.push(format!("disk={:.0}G", d.free_gib));
    }
    if let (Some(h), Some(days)) = (sys.powered_hours_per_day, sys.powered_span_days) {
        f.push(format!("powered={h:.0}h/d over {days:.0}d"));
    }
    if let Some(r) = region {
        f.push(format!("edge={r}"));
    }

    if steam.found && steam.titles > 0 {
        f.push(format!(
            "steam={} titles/{}",
            steam.titles,
            steam::size_band(steam.bytes_on_disk)
        ));
        if let Some((s, e)) = steam.peak_window {
            f.push(format!("plays={s:02}-{e:02}h n={}", steam.launch_samples));
        }
    }

    let a = |o: &Option<String>| o.clone().unwrap_or_else(|| "-".into());
    f.push(format!(
        "role={} share={} pays={}",
        a(&answers.role),
        a(&answers.share_for),
        a(&answers.pays_today)
    ));
    if let Some(o) = &answers.other_linux {
        f.push(format!("otherlinux={o}"));
    }

    f.push(verdict.tag().to_string());
    f.join(" | ")
}

// ------------------------------------------------------------------ output ---

pub fn print_checks(host: &HostReport) {
    println!("\n\x1b[1mCan this machine run a Nestri box?\x1b[0m");
    for c in &host.checks {
        let (mark, colour) = match c.state {
            State::Pass => ("ok  ", "32"),
            State::Fail => ("no  ", "31"),
            State::Unknown => ("?   ", "33"),
        };
        println!("  \x1b[{colour}m{mark}\x1b[0m {}", c.what);
        if !c.detail.is_empty() {
            for line in wrap(&c.detail, 68) {
                println!("       \x1b[2m{line}\x1b[0m");
            }
        }
    }
}

pub fn print_verdict(v: Verdict, net: &NetReport) {
    println!();
    let (colour, headline, body) = match v {
        Verdict::HostReady => (
            "32",
            "This machine could host.",
            "Every hard requirement passes and the uplink is good enough. That is rarer \
             than it sounds — most machines fail on the encode extension or on queueing.",
        ),
        Verdict::HostBlockedByNetwork => (
            "33",
            "Good machine, the network is in the way.",
            "The hardware and the software are fine. See the uplink figures above — if the \
             problem is added latency rather than throughput, it is a router setting and not \
             a line you need to upgrade.",
        ),
        Verdict::HostReadyLocalOnly => (
            "32",
            "This machine could host — for players near you.",
            "Every requirement passes and your uplink queues cleanly. But the idle round              trip to the nearest major network is already most of the latency budget, and              that is distance rather than a fault: no upgrade shortens it. So this machine              is a good host for people on your side of the world and cannot be one for              anybody else. If you are somewhere without a cloud gaming edge, that is not a              consolation prize — it is the only way anyone there gets a playable stream.",
        ),
        Verdict::HostFixable => (
            "33",
            "This machine could host, with some setup.",
            "Nothing here is a hardware limit — what is missing can be installed.",
        ),
        Verdict::ClientOnly => (
            "36",
            "This is a client, not a host.",
            "Which is a complete answer and not a failure: most machines are clients, and \
             the thing you would actually use Nestri for works fine from here.",
        ),
        Verdict::Unknown => (
            "33",
            "Inconclusive.",
            "One or more checks could not be run rather than failing. The report says which; \
             an unknown is not a no.",
        ),
    };
    println!("\x1b[1;{colour}m{headline}\x1b[0m");
    for line in wrap(body, 72) {
        println!("\x1b[2m{line}\x1b[0m");
    }
    if !net.note.is_empty() {
        println!();
        for line in wrap(&net.note, 72) {
            println!("\x1b[33m{line}\x1b[0m");
        }
    }
}

/// Wrap on whitespace. Twelve lines rather than a dependency, per `Cargo.toml`.
fn wrap(s: &str, width: usize) -> Vec<String> {
    let mut out = vec![String::new()];
    for word in s.split_whitespace() {
        let cur = out.last_mut().unwrap();
        if !cur.is_empty() && cur.chars().count() + 1 + word.chars().count() > width {
            out.push(word.to_string());
        } else {
            if !cur.is_empty() {
                cur.push(' ');
            }
            cur.push_str(word);
        }
    }
    out.retain(|l| !l.is_empty());
    out
}

/// Put the summary line on the clipboard, and say which tool did it.
///
/// Selecting a long line out of a terminal is fiddly and it is the last step
/// before we learn anything, so it should not be work. Every one of these ships
/// with the desktop it belongs to; where none is present we simply say so and
/// the line is still on screen.
pub fn to_clipboard(line: &str) -> Option<&'static str> {
    use std::io::Write;
    use std::process::{Command, Stdio};

    const TOOLS: [(&str, &[&str]); 5] = [
        ("wl-copy", &[]),                        // Wayland
        ("xclip", &["-selection", "clipboard"]), // X11
        ("xsel", &["--clipboard", "--input"]),   // X11, the other one
        ("pbcopy", &[]),                         // macOS
        ("clip", &[]),                           // Windows
    ];

    for (tool, args) in TOOLS {
        let Ok(mut child) = Command::new(tool)
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
        else {
            continue;
        };
        let wrote = child
            .stdin
            .as_mut()
            .is_some_and(|s| s.write_all(line.as_bytes()).is_ok());
        // Wait either way, so a failed tool is not left running.
        let ok = child.wait().map(|s| s.success()).unwrap_or(false);
        if wrote && ok {
            return Some(tool);
        }
    }
    None
}

// ------------------------------------------------------------------ submit ---

/// Percent-encode everything that is not unreserved. Small enough to write.
fn enc(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// The URL that submits this run.
///
/// Query parameters rather than an opaque blob, deliberately. A base64 payload
/// would be shorter and would let us send more, and it would also mean the
/// person clicking cannot read what they are sending — which is the one thing
/// this program has going for it. Readable parameters are self-documenting, and
/// the length is nowhere near a browser limit.
///
/// Carries more than the clipboard line does, because it is not something
/// anyone has to eyeball in a chat window: every check individually, the full
/// latency triple, the 24-hour launch histogram, and the five largest titles.
pub fn submit_url(base: &str, f_: &Full) -> String {
    let (sys, host, net, steam, answers, verdict, region) = (
        f_.sys,
        f_.host,
        f_.net,
        f_.steam,
        f_.answers,
        f_.verdict,
        &f_.region_hint,
    );
    let mut q: Vec<String> = Vec::new();
    let mut put = |k: &str, v: String| q.push(format!("{k}={}", enc(&v)));

    put("v", VERSION.to_string());
    put("os", format!("{}/{}", sys.os, sys.arch));
    if let Some(rel) = &sys.release {
        put("rel", rel.clone());
    }
    if let Some(g) = sys
        .gpus
        .iter()
        .find(|g| g.render_node.is_some())
        .or_else(|| sys.gpus.first())
    {
        put("gpu", g.name.clone());
    }
    if sys.gpus.len() > 1 {
        put("gpus", sys.gpus.len().to_string());
        // Every adapter, not just the count. The first Windows submission
        // reported `gpus=2` with a virtual adapter as the primary, which told
        // us something had been lost but not what.
        put(
            "gpulist",
            sys.gpus
                .iter()
                .map(|g| g.name.as_str())
                .collect::<Vec<_>>()
                .join("~"),
        );
    }
    put("cpu", sys.cpu_threads.to_string());
    if let Some(m) = &sys.cpu_model {
        put("cpumodel", m.clone());
    }
    if let Some(r) = sys.ram_gib {
        put("ram", format!("{r:.0}"));
    }

    // Every check, individually — the aggregate verdict hides which single
    // requirement stops people, which is the thing worth knowing.
    for c in &host.checks {
        // Prefixed: the `gpu` check id would otherwise overwrite the GPU model
        // parameter, and last-writer-wins in a query string is a silent loss.
        put(
            &format!("ck_{}", c.id),
            match c.state {
                State::Pass => "y",
                State::Fail => "n",
                State::Unknown => "?",
            }
            .to_string(),
        );
    }

    if let Some(u) = net.upstream_mbps {
        put("up", format!("{u:.1}"));
    }
    if let Some(v) = net.idle_rtt_ms {
        put("rtt", format!("{v:.0}"));
    }
    if let Some(v) = net.idle_rtt_p50_ms {
        put("rttidle50", format!("{v:.0}"));
    }
    if let Some(v) = net.loaded_rtt_ms {
        put("rttload", format!("{v:.0}"));
    }
    if let Some(v) = net.loaded_rtt_p95_ms {
        put("rttp95", format!("{v:.0}"));
    }
    if let Some(v) = net.bloat_ms {
        put("bloat", format!("{v:.0}"));
    }
    if let Some(g) = net.grade {
        put("grade", g.to_string());
    }
    if let Some(r) = region {
        put("edge", r.clone());
    }

    if let Some(d) = sys.disks.first() {
        put("disk", format!("{:.0}", d.free_gib));
        if let Some(fs) = &d.fs {
            put("diskfs", fs.clone());
        }
    }
    put("disks", sys.disks.len().to_string());
    if let (Some(h), Some(s)) = (sys.powered_hours_per_day, sys.powered_span_days) {
        put("powered", format!("{h:.1}"));
        put("span", format!("{s:.0}"));
    }

    if steam.found {
        put("titles", steam.titles.to_string());
        put("gib", format!("{:.0}", steam::gib(steam.bytes_on_disk)));
        if steam.launch_samples > 0 {
            put(
                "hours",
                steam
                    .launch_hours
                    .iter()
                    .map(u32::to_string)
                    .collect::<Vec<_>>()
                    .join(","),
            );
            put("n", steam.launch_samples.to_string());
            put("profiles", steam.profiles.to_string());
            if steam.launches_uninstalled > 0 {
                put("ngone", steam.launches_uninstalled.to_string());
            }
        }
        if let Some((a, b)) = steam.peak_window {
            put("peak", format!("{a}-{b}"));
        }
        if !steam.largest.is_empty() {
            // Whether the title distribution has a head decides whether a depot
            // cache is worth building at all, and it cannot be seen from counts.
            put(
                "top",
                steam
                    .largest
                    .iter()
                    .map(|(n, _)| n.as_str())
                    .collect::<Vec<_>>()
                    .join("~"),
            );
        }
    }

    for (k, v) in [
        ("want", &answers.want),
        ("role", &answers.role),
        ("share", &answers.share_for),
        ("pays", &answers.pays_today),
        ("otherlinux", &answers.other_linux),
    ] {
        if let Some(v) = v {
            put(k, v.clone());
        }
    }
    put("verdict", verdict.tag().to_string());

    format!("{}/?{}", base.trim_end_matches('/'), q.join("&"))
}

/// Plain English list of what the submit URL contains, printed before it opens.
///
/// The URL is readable, but it is also 800 characters long and nobody reads
/// 800 characters. This is the honest summary of it.
pub fn submit_contents(steam: &SteamReport, answers: &Answers) -> Vec<&'static str> {
    let mut v = vec![
        "this machine's OS, CPU, RAM and GPU model",
        "which host requirements passed and which did not",
        "the network figures you just saw",
        "free disk space, and how long this machine tends to stay on",
    ];
    if steam.found && steam.titles > 0 {
        v.push("how many games are installed, their total size, and your five largest");
        if steam.launch_samples > 0 {
            v.push("the hour-of-day histogram above — hours, never dates");
        }
    }
    if answers.want.is_some()
        || answers.role.is_some()
        || answers.share_for.is_some()
        || answers.pays_today.is_some()
    {
        v.push("your answers to the questions");
    }
    v.push("no hostname, no IP address, no username, no file paths");
    v
}

/// Hand a URL to whatever the desktop uses to open links.
pub fn open_in_browser(url: &str) -> bool {
    use std::process::{Command, Stdio};
    let attempts: [(&str, &[&str]); 4] = [
        ("xdg-open", &[]),
        ("open", &[]),                 // macOS
        ("cmd", &["/C", "start", ""]), // Windows
        ("wslview", &[]),              // WSL, where xdg-open is often absent
    ];
    for (cmd, args) in attempts {
        if Command::new(cmd)
            .args(args)
            .arg(url)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
        {
            return true;
        }
    }
    false
}
