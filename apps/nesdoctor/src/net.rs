//! The network test, and the reason anybody runs this.
//!
//! Two numbers, and the second is the one that matters:
//!
//! 1. **Sustained upstream**, because a session is video going the unusual way
//!    down a domestic line.
//! 2. **Added latency under load** — bufferbloat. A saturated consumer uplink
//!    adds 100–500 ms of queueing delay unless the router runs `fq_codel` or
//!    CAKE, and against a click-to-photon budget that has already spent ~58 ms
//!    on render, encode, decode, display and jitter buffer, **that is more than
//!    the entire remaining allowance.**
//!
//! So a peer with 500 Mbps up and no queue management is unusable, and one with
//! 25 Mbps and CAKE is fine. Throughput is the number everyone volunteers and
//! it is the wrong one. This is also why the test is worth running for its own
//! sake: almost nobody has ever seen their own figure.
//!
//! Method: measure TCP connect time (one round trip, no privileges, no ICMP)
//! to a fixed anycast address; then saturate the uplink with parallel HTTPS
//! uploads and measure the same thing again. The difference is the queue.

use std::io::Write;
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};

use serde::Serialize;

/// Cloudflare's speed-test sink. Chosen because it is anycast (so the path is
/// short from anywhere, which keeps this a test of the *access* link rather
/// than of the distance to us), it discards uploads, and it is not ours — we
/// have no server to keep alive and no data arrives anywhere we control.
const UPLOAD_URL: &str = "https://speed.cloudflare.com/__up";

/// Latency target. `1.1.1.1:443` answers a TCP handshake from essentially
/// everywhere and is anycast for the same reason as above.
const PROBE_ADDR: &str = "1.1.1.1:443";

/// How long to hold the uplink saturated. Long enough for a queue to fill —
/// a short burst measures nothing, because bufferbloat is a steady-state
/// property — and short enough not to ruin someone's evening.
const LOAD_SECONDS: u64 = 8;

/// Every HTTP call gets a hard ceiling.
///
/// Without one, an intermediary that accepts a connection and then stalls
/// leaves `send` blocked forever: the stop flag cannot interrupt a blocking
/// call, so the joins below never return and **nesdoctor never prints its
/// report at all.** A hang is the worst outcome available to a program someone
/// runs once, because there is no second chance to ask them.
const HTTP_TIMEOUT: Duration = Duration::from_secs(15);
const STREAMS: usize = 3;
const CHUNK: usize = 1 << 20; // 1 MiB per write

#[derive(Debug, Serialize)]
pub struct NetReport {
    /// The **floor** of the idle distribution, which is the propagation delay
    /// the path is capable of. Baseline for [`NetReport::bloat_ms`].
    pub idle_rtt_ms: Option<f64>,
    /// The **typical** idle round trip. Reported separately because the two
    /// answer different questions and, on a badly routed link, differ wildly.
    pub idle_rtt_p50_ms: Option<f64>,
    pub loaded_rtt_ms: Option<f64>,
    pub loaded_rtt_p95_ms: Option<f64>,
    /// Loaded minus idle: the queue, in milliseconds.
    pub bloat_ms: Option<f64>,
    /// Sustained upstream over the steady-state window only: the 1.5 s ramp is
    /// excluded from the bytes *and* from the clock. Never divide a byte count
    /// by a window that does not contain it.
    pub upstream_mbps: Option<f64>,
    /// A, B, C or F. See [`grade`].
    pub grade: Option<&'static str>,
    pub note: String,
}

impl NetReport {
    /// A report with no numbers, carrying the reason. Used both for `--no-net`
    /// and for a genuine failure, because the caller has to render the same
    /// "we do not know" either way.
    pub fn unmeasured(note: &str) -> Self {
        Self::unavailable(note)
    }

    fn unavailable(note: &str) -> Self {
        Self {
            idle_rtt_ms: None,
            idle_rtt_p50_ms: None,
            loaded_rtt_ms: None,
            loaded_rtt_p95_ms: None,
            bloat_ms: None,
            upstream_mbps: None,
            grade: None,
            note: note.to_string(),
        }
    }
}

/// Bufferbloat grade, on the added-latency thresholds that matter to us rather
/// than to a generic speed test.
///
/// The bands come from the frame budget, not from convention: ~40 ms of RTT is
/// the whole network allowance for a 100 ms click-to-photon target, so 30 ms of
/// *added* delay has already eaten most of it.
fn grade(bloat_ms: f64) -> &'static str {
    match bloat_ms {
        b if b < 15.0 => "A",
        b if b < 30.0 => "B",
        b if b < 80.0 => "C",
        _ => "F",
    }
}

/// One agent for every request this module makes, carrying the timeout.
fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(HTTP_TIMEOUT))
        .build()
        .into()
}

pub fn run() -> NetReport {
    let Some(addr) = resolve(PROBE_ADDR) else {
        return NetReport::unavailable("could not resolve the latency probe address — offline?");
    };

    // --- idle baseline ---------------------------------------------------
    //
    // Twenty samples, not twelve. Measured on a Nairobi connection
    // 2026-09-02, twelve idle handshakes to one anycast address came back
    // **bimodal** -- `[56, 56, 57, 59, 60, 176, 177, 179, 179, 179, 182, 368]`,
    // two different points of presence answering, 312 ms of spread on an *idle*
    // link.
    let idle = sample_rtt(addr, 20, Duration::from_millis(120));
    let Some(idle_min) = percentile(&idle, 0.0) else {
        return NetReport::unavailable(
            "no TCP handshake completed to 1.1.1.1:443 — a firewall may block it, so the \
             latency half could not run",
        );
    };

    // --- saturate, and measure again -------------------------------------
    let stop = Arc::new(AtomicBool::new(false));
    let sent = Arc::new(AtomicU64::new(0));

    let uploaders: Vec<_> = (0..STREAMS)
        .map(|_| {
            let stop = Arc::clone(&stop);
            let sent = Arc::clone(&sent);
            let ag = agent();
            std::thread::spawn(move || upload_until(&ag, &stop, &sent))
        })
        .collect();

    // Give the queue a moment to actually fill before sampling: measuring from
    // t=0 averages in the unloaded state and understates the bloat.
    std::thread::sleep(Duration::from_millis(1500));

    // Throughput is measured from *here*, and so are the bytes.
    //
    // This used to divide every byte sent since the threads started — the ramp
    // above included — by a window with that same ramp subtracted from it, so
    // the numerator covered ~8.3 s and the denominator ~6.8 s and **every
    // published `up=` figure was overstated by about a fifth.** It was found by
    // running `speedtest` on the same line in the same afternoon (284 Mbps
    // against our 502) and it is invisible to re-reading, because the code was
    // self-consistent and the number it printed was plausible.
    //
    // Excluding the ramp from both is also the better measurement: TCP
    // slow-start lives in there, so the first 1.5 s is not the steady state
    // that a session would actually get.
    //
    // What remains is a boundary effect, and it is worth knowing rather than
    // claiming exactness: bytes land on the counter one completed 8 MiB POST at
    // a time, so a request straddling the snapshot below is counted whole. That
    // is up to `STREAMS * 8 MiB` attributed to a window it only partly occupies
    // — a few per cent, still upward. Read `up=` as a figure with a ceiling of
    // roughly that, not as a calibrated number.
    let measure_from = Instant::now();
    let sent_before = sent.load(Ordering::Relaxed);

    let loaded = sample_rtt(
        addr,
        (LOAD_SECONDS as usize - 2) * 4,
        Duration::from_millis(250),
    );

    stop.store(true, Ordering::Relaxed);
    let mut any_upload_ok = false;
    for h in uploaders {
        any_upload_ok |= h.join().unwrap_or(false);
    }

    let elapsed = measure_from.elapsed().as_secs_f64();
    let bytes = sent.load(Ordering::Relaxed).saturating_sub(sent_before) as f64;
    let upstream_mbps = (any_upload_ok && elapsed > 1.0 && bytes > 0.0)
        .then(|| bytes * 8.0 / elapsed / 1_000_000.0);

    let loaded_p50 = percentile(&loaded, 0.50);
    let loaded_p95 = percentile(&loaded, 0.95);
    let idle_p50 = percentile(&idle, 0.50);

    // Bloat is measured against the **minimum**, not the median.
    //
    // Queueing is delay *above the floor the path can do*, so the floor is the
    // baseline; that is also how every bufferbloat test does it. Using the
    // median was a real bug and it failed in the dangerous direction: on the
    // bimodal link above, the idle median landed at 188 ms while the loaded
    // median came back 181 ms, so the difference went negative, clamped to
    // zero, and reported **grade A on a connection that measures +115 ms and
    // grade F**. A tool whose headline number can say "fine" about a line that
    // is not fine has no business being trusted with the rest.
    let bloat = loaded_p50.map(|l| (l - idle_min).max(0.0));

    let note = match (&upstream_mbps, &bloat) {
        (None, _) => "upstream could not be measured (the upload sink was unreachable), so the \
                      latency figures below are not under a known load and should be ignored"
            .to_string(),
        (Some(_), Some(b)) if *b >= 80.0 => {
            "your uplink queues badly under load. This is a router setting, not a line \
             problem: fq_codel or CAKE on the upload direction usually fixes it entirely."
                .to_string()
        }
        _ => String::new(),
    };

    NetReport {
        idle_rtt_ms: Some(idle_min),
        idle_rtt_p50_ms: idle_p50,
        loaded_rtt_ms: loaded_p50,
        loaded_rtt_p95_ms: loaded_p95,
        bloat_ms: bloat,
        upstream_mbps,
        grade: bloat.map(grade),
        note,
    }
}

fn resolve(s: &str) -> Option<SocketAddr> {
    s.to_socket_addrs().ok()?.next()
}

/// `n` TCP handshakes, spaced by `gap`, in milliseconds. Failures are dropped
/// rather than recorded as a large value: a refused connection is not a slow
/// one, and averaging the two produces a number that means nothing.
fn sample_rtt(addr: SocketAddr, n: usize, gap: Duration) -> Vec<f64> {
    let mut out = Vec::with_capacity(n);
    for _ in 0..n {
        let t = Instant::now();
        if TcpStream::connect_timeout(&addr, Duration::from_secs(2)).is_ok() {
            out.push(t.elapsed().as_secs_f64() * 1000.0);
        }
        std::thread::sleep(gap);
    }
    out
}

/// `p` of 0.0 gives the minimum, which is what the bloat baseline uses.
fn percentile(v: &[f64], p: f64) -> Option<f64> {
    if v.is_empty() {
        return None;
    }
    let mut s = v.to_vec();
    s.sort_by(f64::total_cmp);
    let i = ((s.len() as f64 - 1.0) * p).round() as usize;
    Some(s[i])
}

/// Upload until told to stop, counting bytes. Returns whether anything was
/// accepted at all, so the caller can distinguish "slow" from "blocked".
///
/// The body is generated rather than read from anywhere, and is
/// incompressible-enough zeroes; the sink discards it.
fn upload_until(ag: &ureq::Agent, stop: &AtomicBool, sent: &AtomicU64) -> bool {
    let mut ok = false;
    let chunk = vec![0u8; CHUNK];
    while !stop.load(Ordering::Relaxed) {
        // One request per 8 MiB rather than one endless request: a long-lived
        // POST can be buffered by an intermediary, which would make the timing
        // a measure of the proxy rather than of the line.
        let body: Vec<u8> = chunk.repeat(8);
        let n = body.len() as u64;
        match ag
            .post(UPLOAD_URL)
            .header("content-type", "application/octet-stream")
            .send(&body[..])
        {
            Ok(_) => {
                ok = true;
                sent.fetch_add(n, Ordering::Relaxed);
            }
            Err(_) => {
                // One failure is a hiccup; the loop exits on the flag anyway.
                std::thread::sleep(Duration::from_millis(200));
            }
        }
    }
    ok
}

/// Best-effort public-facing region, from Cloudflare's trace endpoint.
///
/// This answers "roughly where are you" without asking it, and it is coarse on
/// purpose: the IATA code of the edge that served the request, which
/// is a latency radius rather than a location. No IP address is retained and
/// none goes into the summary line.
pub fn region_hint() -> Option<String> {
    let body = agent()
        .get("https://speed.cloudflare.com/cdn-cgi/trace")
        .call()
        .ok()?
        .body_mut()
        .read_to_string()
        .ok()?;
    let mut loc = None;
    let mut colo = None;
    for line in body.lines() {
        match line.split_once('=') {
            Some(("loc", v)) => loc = Some(v.to_string()),
            Some(("colo", v)) => colo = Some(v.to_string()),
            _ => {}
        }
    }
    match (loc, colo) {
        (Some(l), Some(c)) => Some(format!("{l}/{c}")),
        (Some(l), None) => Some(l),
        (None, c) => c,
    }
}

/// Write a fixed prompt to the terminal and flush. Here rather than in `ask`
/// because the network test narrates while it runs.
pub fn tick(msg: &str) {
    print!("{msg}");
    let _ = std::io::stdout().flush();
}
