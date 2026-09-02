//! nesdoctor — is this machine any good, as a Nestri host or as a client?
//!
//! # What it is
//!
//! The first executable form of our host requirements. Until now a host was
//! qualified by a human reading a table, and a requirement nothing can check is
//! one that is silently optional. It is also the qualification anyone offering a
//! machine has to pass — and the check that decides it is loaded latency, not
//! throughput.
//!
//! # Usage
//!
//! ```text
//! nesdoctor [OPTIONS]
//!
//!   --no-net       Skip the network test (it uploads ~100 MB)
//!   --no-steam     Never look at Steam, and do not ask
//!   --yes          Accept the prompts; still prints, still saves nothing remote
//!   --json <PATH>  Where to write the full report [default: ./nesdoctor.json]
//!   --quiet        Only the summary line, for scripting
//! ```
//!
//! # What it does not do
//!
//! **It has no server.** Nothing is uploaded, no telemetry endpoint exists, and
//! there is no build of this program that reports home — the network test talks
//! to Cloudflare's public speed-test sink and to `1.1.1.1`, neither of which is
//! ours. The output is a line on your terminal. If you want us to have it, you
//! paste it somewhere; if you do not, we never had it.
//!
//! That is a design decision and not a promise about our intentions: there is
//! nothing to trust, because there is nothing to switch on later.
//!
//! # Why anyone would run it
//!
//! Because of one number almost nobody has ever seen: how much latency their
//! own connection adds when it is busy. Throughput is the figure everybody
//! knows and it is the wrong one — a 500 Mbps uplink that queues for 300 ms
//! under load cannot carry an interactive stream, and a 25 Mbps one with
//! `fq_codel` can.

mod ask;
mod hostreq;
mod net;
mod report;
mod steam;
mod sys;
mod vdf;

use std::io::{IsTerminal, Write};
use std::path::PathBuf;

use clap::Parser;

#[derive(Parser, Debug)]
#[command(
    name = "nesdoctor",
    about = "Is this machine any good, as a Nestri host or as a client?",
    version
)]
struct Args {
    /// Skip the network test. It uploads roughly 100 MB to a public speed-test
    /// sink; on a metered connection that is worth knowing about up front.
    #[arg(long)]
    no_net: bool,

    /// Never read Steam, and do not ask about it.
    #[arg(long)]
    no_steam: bool,

    /// Answer the prompts affirmatively and take the defaults. Intended for a
    /// second run, not a first one — the questions are the point.
    #[arg(long)]
    yes: bool,

    /// Where to write the full report.
    ///
    /// Relative to the working directory, which during development is a git
    /// checkout -- and this file contains the operator's own machine: home
    /// paths, installed titles, launch times. It was committed to the public
    /// repository once by accident. `.gitignore` now covers the default name,
    /// and the default is deliberately not something like `report.json` that
    /// an ignore rule would miss.
    #[arg(long, default_value = "nesdoctor.json")]
    json: PathBuf,

    /// Print only the summary line.
    #[arg(long)]
    quiet: bool,

    /// Where the submit link points. Override to test against a local worker.
    #[arg(long, default_value = "https://doctor.nestri.io")]
    submit_url: String,

    /// Do not offer to open a browser; just print the link.
    #[arg(long)]
    no_open: bool,
}

fn main() {
    let args = Args::parse();

    if !args.quiet {
        banner();
    }

    // --- what the machine is ---------------------------------------------
    if !args.quiet {
        net::tick("  reading hardware…");
    }
    let sys = sys::probe();
    if !args.quiet {
        println!(" done");
        print_sys(&sys);
    }

    // --- can it host ------------------------------------------------------
    let host = hostreq::probe(&sys);
    if !args.quiet {
        report::print_checks(&host);
    }

    // --- the network ------------------------------------------------------
    let netr = if args.no_net {
        net::NetReport::unmeasured("skipped with --no-net")
    } else {
        if !args.quiet {
            println!("\n\x1b[1mNetwork\x1b[0m");
            println!(
                "\x1b[2m  About 20 seconds. This saturates your upload on purpose — that is the\x1b[0m"
            );
            println!(
                "\x1b[2m  only way to see the number that matters — so expect a video call to\x1b[0m"
            );
            println!("\x1b[2m  stutter while it runs. Roughly 100 MB of upload.\x1b[0m");
            net::tick("  measuring…");
        }
        let r = net::run();
        if !args.quiet {
            println!(" done");
            print_net(&r);
        }
        r
    };

    let region = if args.no_net {
        None
    } else {
        net::region_hint()
    };

    // --- the questions ----------------------------------------------------
    let steam_present = !args.no_steam && steam::present();
    let capable = sys.os == "linux"
        && sys
            .gpus
            .iter()
            .any(|g| matches!(g.vendor.as_deref(), Some("AMD") | Some("Intel")));

    // Do not ask questions that cannot be answered. `--quiet` promises a single
    // parseable line, and a prompt written to stdout breaks that promise; a
    // non-terminal stdin cannot answer at all, so prompting into it just prints
    // the whole questionnaire and skips every item. Both cases used to print
    // three questions and then "skipped" -- found by the CI smoke test, which
    // is the only reason anything runs this way.
    let interactive = !args.quiet && std::io::stdin().is_terminal();

    let answers = if args.yes || !interactive {
        ask::Answers {
            // `--yes` is a deliberate consent; a pipe is not consent to read
            // somebody's library.
            steam_consent: args.yes && steam_present,
            ..Default::default()
        }
    } else {
        ask::run(&ask::Ctx {
            could_host: host.could_host,
            capable,
            is_linux: sys.os == "linux",
            steam_present,
        })
    };

    // --- Steam, only with a yes -------------------------------------------
    let steamr = if answers.steam_consent {
        let r = steam::read();
        if !args.quiet {
            print_steam(&r);
        }
        r
    } else {
        steam::SteamReport::default()
    };

    // --- verdict ----------------------------------------------------------
    let v = report::verdict(&sys, &host, &netr);
    if !args.quiet {
        report::print_verdict(v, &netr);
    }

    let full = report::Full {
        nesdoctor: report::VERSION,
        sys: &sys,
        host: &host,
        net: &netr,
        steam: &steamr,
        answers: &answers,
        verdict: v,
        region_hint: region.clone(),
    };
    let line = report::summary_line(&full);

    // --- the full report, locally -----------------------------------------
    let wrote = serde_json::to_string_pretty(&full)
        .ok()
        .and_then(|j| std::fs::write(&args.json, j).ok().map(|_| ()))
        .is_some();

    if args.quiet {
        println!("{line}");
        return;
    }

    let url = report::submit_url(&args.submit_url, &full);

    println!();
    println!("\x1b[1m─── One keystroke and we are done ───────────────────────────────\x1b[0m");
    println!();
    println!("\x1b[2m  Everything above goes to us through this link. It contains:\x1b[0m");
    for item in report::submit_contents(&steamr, &answers) {
        println!("\x1b[2m    · {item}\x1b[0m");
    }
    println!();
    println!("\x1b[2m  {}\x1b[0m", args.submit_url);
    println!();

    let opened = if args.no_open || !interactive {
        false
    } else {
        print!(
            "\x1b[1;97;44m  Press Enter to send it  \x1b[0m\x1b[2m  (or Ctrl-C to send nothing)  \x1b[0m"
        );
        let _ = std::io::stdout().flush();
        let mut s = String::new();
        let _ = std::io::stdin().read_line(&mut s);
        println!();
        report::open_in_browser(&url)
    };

    if opened {
        println!("\x1b[32m  ✓ Opened in your browser. That is it — thank you.\x1b[0m");
        println!(
            "\x1b[2m    If the page did not load, the link is below and it still works later.\x1b[0m"
        );
    } else {
        println!("\x1b[1m  Open this to send it:\x1b[0m");
    }
    println!();
    println!("\x1b[4;36m{url}\x1b[0m");
    println!();

    // The clipboard line stays as the offline path: a headless host, a machine
    // with no browser, or somebody who would rather paste into a channel than
    // click a link we wrote.
    let clip = report::to_clipboard(&line);
    println!("\x1b[2m  Prefer to paste it yourself? The short version:\x1b[0m");
    println!();
    println!("  {line}");
    if let Some(tool) = clip {
        println!("\x1b[2m  (also on your clipboard, via {tool})\x1b[0m");
    }

    if wrote {
        println!();
        println!("\x1b[1m  And if you feel like being properly helpful\x1b[0m");
        println!(
            "\x1b[2m    {} has the long version — every check with its reason, the\x1b[0m",
            args.json.display()
        );
        println!(
            "\x1b[2m    full latency series, and your installed titles with sizes and launch\x1b[0m"
        );
        println!(
            "\x1b[2m    times. It is more useful to us than anything above, because it is what\x1b[0m"
        );
        println!(
            "\x1b[2m    lets us size a real game library. Have a read and send it along if\x1b[0m"
        );
        println!("\x1b[2m    nothing in there bothers you.\x1b[0m");
    }
    println!();
}

fn banner() {
    println!();
    println!("\x1b[1mnesdoctor {}\x1b[0m", report::VERSION);
    println!("\x1b[2mChecks whether this machine can host a Nestri box, measures what your\x1b[0m");
    println!("\x1b[2mconnection actually does under load, and asks at most five questions.\x1b[0m");
    println!();
    println!(
        "\x1b[2mNothing is uploaded. There is no server to upload to — the output is a\x1b[0m"
    );
    println!("\x1b[2mline on your terminal that you may choose to paste somewhere.\x1b[0m");
    println!();
}

fn print_sys(s: &sys::SysInfo) {
    println!("\n\x1b[1mMachine\x1b[0m");
    println!(
        "  {} {} · {}",
        s.os,
        s.arch,
        s.release.clone().unwrap_or_else(|| "unknown".into())
    );
    if let Some(c) = &s.cpu_model {
        println!(
            "  {c} · {} threads · {} RAM",
            s.cpu_threads,
            s.ram_gib.map_or("?".into(), |g| format!("{g:.0} GiB"))
        );
    }
    for g in &s.gpus {
        println!(
            "  {}{}",
            g.name,
            g.render_node
                .as_ref()
                .map(|r| format!(" · {r}"))
                .unwrap_or_default()
        );
    }
    for d in s.disks.iter().take(3) {
        println!(
            "  {} · {} · {:.0} GiB free",
            d.mount,
            d.fs.clone().unwrap_or_else(|| "?".into()),
            d.free_gib
        );
    }
    match (s.powered_hours_per_day, s.powered_span_days) {
        (Some(h), Some(days)) => println!(
            "  powered {h:.1} h/day, averaged over {days:.0} days of boot history\n  \
             \x1b[2m(measured, not asked — it counts powered rather than idle, so read it as \
             'always on' vs 'evenings')\x1b[0m"
        ),
        _ => println!("  \x1b[2mno boot history available, so hours-powered is unknown\x1b[0m"),
    }
}

fn print_net(n: &net::NetReport) {
    let f = |o: Option<f64>, unit: &str| {
        o.map(|v| format!("{v:.0}{unit}"))
            .unwrap_or_else(|| "—".into())
    };
    println!("  upstream            {}", f(n.upstream_mbps, " Mbps"));
    println!("  latency, idle       {}", f(n.idle_rtt_ms, " ms"));
    if n.idle_rtt_ms.is_some_and(|r| r > 60.0) {
        println!(
            "  \x1b[2m  That is the round trip to the *nearest* major network, so it is a\x1b[0m"
        );
        println!("  \x1b[2m  floor on what any player sees. It is distance, not a fault.\x1b[0m");
    }
    println!("  latency, loaded     {}", f(n.loaded_rtt_ms, " ms"));
    println!("  latency, loaded p95 {}", f(n.loaded_rtt_p95_ms, " ms"));
    match (n.bloat_ms, n.grade) {
        (Some(b), Some(g)) => {
            let colour = match g {
                "A" => "32",
                "B" => "32",
                "C" => "33",
                _ => "31",
            };
            println!("  \x1b[1madded under load    \x1b[{colour}m+{b:.0} ms   grade {g}\x1b[0m");
            println!(
                "  \x1b[2m  A/B is fine, C is marginal, F cannot carry an interactive stream.\x1b[0m"
            );
            println!(
                "  \x1b[2m  The whole network allowance is about 40 ms, because render, encode,\x1b[0m"
            );
            println!(
                "  \x1b[2m  decode, display and the jitter buffer have already spent ~58 ms.\x1b[0m"
            );
        }
        _ => println!("  added under load    —"),
    }
}

fn print_steam(s: &steam::SteamReport) {
    if !s.found {
        return;
    }
    println!("\n\x1b[1mSteam\x1b[0m");
    println!(
        "  {} titles installed · {:.0} GiB on disk",
        s.titles,
        steam::gib(s.bytes_on_disk)
    );
    for (name, bytes) in &s.largest {
        println!("    {:>6.0} GiB  {}", steam::gib(*bytes), name);
    }
    if s.profiles > 1 {
        println!(
            "  \x1b[2m{} Steam profiles here — the hours below are the busiest one, not all of\x1b[0m",
            s.profiles
        );
        println!("  \x1b[2mthem added together, which would be a histogram of nobody.\x1b[0m");
    }
    if s.launch_samples > 0 {
        println!(
            "\n  When you launch games — {} launch records{}, local time:",
            s.launch_samples,
            if s.launches_uninstalled > 0 {
                format!(
                    ", {} of them games you no longer have installed",
                    s.launches_uninstalled
                )
            } else {
                String::new()
            }
        );
        println!("    {}", steam::sparkline(&s.launch_hours));
        println!("    \x1b[2m0h          6h          12h         18h        23h\x1b[0m");
        if let Some((a, b)) = s.peak_window {
            println!("  Half of your launches fall between \x1b[1m{a:02}:00 and {b:02}:59\x1b[0m.");
            let width = if b >= a { b - a + 1 } else { 24 - a + b + 1 };
            if width <= 6 {
                println!(
                    "  \x1b[2mThat is a narrow window, which is what a peak looks like.\x1b[0m"
                );
            } else {
                println!("  \x1b[2mThat is spread out — no strong peak.\x1b[0m");
            }
        }
    }
    let _ = std::io::stdout().flush();
}
