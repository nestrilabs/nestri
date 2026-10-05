//! How much PyroWave an iroh connection carries.
//!
//! Sends PyroWave-shaped frames at a set rate through the same packing and the
//! same skip rule the hub uses, and collects them with the same collector the
//! client uses, then says what got through. Run it before trusting a rate:
//!
//! ```text
//! # CPU cost of the transport alone, both ends in this process:
//! cargo run --release -p neshub --example pyro_bench -- loopback --mbps 300
//!
//! # The real thing, across a LAN. On the sending machine:
//! cargo run --release -p neshub --example pyro_bench -- serve --mbps 300
//! # and on the receiving one, with what `serve` printed:
//! cargo run --release -p neshub --example pyro_bench -- connect <addr>
//! ```
//!
//! Options: `--mbps`, `--fps` (60), `--secs` (10).

use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail};
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use bytes::Bytes;
use iroh::endpoint::{Connection, QuicTransportConfig, presets};

use nesprotocol::ALPN_VIDEO;
use nesprotocol::datagram::DGRAM_BUFFER_BYTES;
use nesprotocol::pyrowave::{
    FrameMeta, PYRO_DGRAM_HDR_LEN, PyroCollector, PyroFrame, decode_pyro_datagram, pack_datagrams,
    should_skip,
};

/// Datagrams taken per receive, as the client takes them.
const RECV_BATCH: usize = 64;

struct Opts {
    mbps: u64,
    fps: u64,
    secs: u64,
}

fn transport() -> QuicTransportConfig {
    QuicTransportConfig::builder()
        .datagram_send_buffer_size(DGRAM_BUFFER_BYTES)
        .datagram_receive_buffer_size(Some(DGRAM_BUFFER_BYTES))
        .build()
}

async fn endpoint(alpn: bool) -> Result<iroh::Endpoint> {
    let mut b = iroh::Endpoint::builder(presets::N0)
        .relay_mode(iroh::endpoint::RelayMode::Disabled)
        .transport_config(transport());
    if alpn {
        b = b.alpns(vec![ALPN_VIDEO.to_vec()]);
    }
    Ok(b.bind().await?)
}

/// A frame of whole packets at `packet` bytes, behind an 8-byte stand-in for
/// the sequence header.
fn frame(bytes: usize, packet: usize) -> PyroFrame {
    let mut data = Vec::with_capacity(bytes + packet);
    let mut packets = Vec::with_capacity(bytes / packet + 2);
    packets.push(0..8);
    data.extend_from_slice(&[0; 8]);
    while data.len() < bytes {
        let start = data.len();
        data.extend((0..packet).map(|k| k as u8));
        packets.push(start..data.len());
    }
    PyroFrame {
        frame: 0,
        meta: FrameMeta::default(),
        critical: 3.min(packets.len()),
        data,
        packets,
    }
}

async fn send(conn: Connection, o: &Opts) -> Result<()> {
    let max = conn
        .max_datagram_size()
        .context("peer does not take datagrams")?;
    let packet = max - PYRO_DGRAM_HDR_LEN;
    let frame_bytes = (o.mbps * 1_000_000 / 8 / o.fps) as usize;
    let mut f = frame(frame_bytes, packet);
    println!(
        "send: {} Mbit/s at {} fps, {} KB frames of {} packets, {packet} B each",
        o.mbps,
        o.fps,
        frame_bytes / 1000,
        f.packets.len()
    );

    let mut tick = tokio::time::interval(Duration::from_micros(1_000_000 / o.fps));
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let end = Instant::now() + Duration::from_secs(o.secs);
    let (mut seq, mut sent, mut skipped) = (0u16, 0u64, 0u64);
    let mut busy = Duration::ZERO;
    let mut second = Instant::now();
    while Instant::now() < end {
        tick.tick().await;
        let t0 = Instant::now();
        f.meta.ts_ms = seq as u32;
        // Read per frame, as the hub does: with several paths up, the limit
        // is the smallest of their MTUs and moves as paths come and go.
        let now_max = conn.max_datagram_size().context("datagrams went away")?;
        let d = pack_datagrams(seq, &f, now_max)?;
        let backlog = DGRAM_BUFFER_BYTES.saturating_sub(conn.datagram_send_buffer_space());
        if should_skip(backlog, d.buf.len(), DGRAM_BUFFER_BYTES).is_some() {
            skipped += 1;
        } else {
            let buf = Bytes::from(d.buf);
            let mut at = 0;
            let batch: Vec<Bytes> = d
                .lens
                .iter()
                .map(|&len| {
                    let datagram = buf.slice(at..at + len);
                    at += len;
                    datagram
                })
                .collect();
            conn.send_many_datagrams(&batch)?;
            seq = seq.wrapping_add(1);
            sent += 1;
        }
        busy += t0.elapsed();

        if second.elapsed() >= Duration::from_secs(1) {
            let path = conn.paths().iter().find(|p| p.is_selected()).map(|p| {
                let s = p.stats();
                (p.rtt(), s.cwnd)
            });
            println!(
                "send: {sent} frames, {skipped} skipped, {:.1} ms of work per frame, path {path:?}",
                busy.as_secs_f64() * 1000.0 / (sent + skipped).max(1) as f64
            );
            (sent, skipped, busy, second) = (0, 0, Duration::ZERO, Instant::now());
        }
    }
    // Let the queue drain before closing, or its tail reads as loss.
    while conn.datagram_send_buffer_space() < DGRAM_BUFFER_BYTES {
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    tokio::time::sleep(Duration::from_millis(200)).await;
    conn.close(0u32.into(), b"done");
    Ok(())
}

async fn receive(conn: Connection) -> Result<()> {
    let start = Instant::now();
    let mut c = PyroCollector::<Bytes>::new();
    let (mut bytes, mut datagrams) = (0u64, 0u64);
    let (mut all_bytes, mut whole, mut partial, mut lost) = (0u64, 0u64, 0u64, 0u64);
    let mut second = Instant::now();
    let mut busy = Duration::ZERO;
    let mut batch = vec![Bytes::new(); RECV_BATCH];
    loop {
        let n = match conn.read_many_datagrams(&mut batch).await {
            Ok(n) => n,
            Err(_) => break,
        };
        let t0 = Instant::now();
        for d in &mut batch[..n] {
            let d = std::mem::take(d);
            datagrams += 1;
            bytes += d.len() as u64;
            if let Some((h, p)) = decode_pyro_datagram(&d) {
                let at = d.len() - p.len();
                c.push(h, d.slice(at..), start.elapsed().as_micros() as u64);
            }
        }
        busy += t0.elapsed();
        if second.elapsed() >= Duration::from_secs(1) {
            c.poll(start.elapsed().as_micros() as u64);
            let s = c.take_stats();
            println!(
                "recv: {:.0} Mbit/s, {datagrams} datagrams, {} whole, {} partial, {} lost, \
                 {} recovered, {:.2} µs of work per datagram",
                bytes as f64 * 8.0 / second.elapsed().as_secs_f64() / 1e6,
                s.whole,
                s.partial,
                s.lost,
                s.recovered,
                busy.as_secs_f64() * 1e6 / datagrams.max(1) as f64
            );
            all_bytes += bytes;
            (whole, partial, lost) = (whole + s.whole, partial + s.partial, lost + s.lost);
            (bytes, datagrams, busy, second) = (0, 0, Duration::ZERO, Instant::now());
        }
    }
    c.poll(u64::MAX);
    let s = c.take_stats();
    (whole, partial, lost) = (whole + s.whole, partial + s.partial, lost + s.lost);
    all_bytes += bytes;
    println!(
        "recv total: {:.0} Mbit/s average, {whole} whole, {partial} partial, {lost} datagrams lost",
        all_bytes as f64 * 8.0 / start.elapsed().as_secs_f64() / 1e6
    );
    Ok(())
}

fn parse() -> Result<(String, Option<String>, Opts)> {
    let mut args = std::env::args().skip(1);
    let mode = args.next().context("mode: loopback, serve or connect")?;
    let mut target = None;
    let mut o = Opts {
        mbps: 300,
        fps: 60,
        secs: 10,
    };
    while let Some(a) = args.next() {
        let mut num = |name: &str| -> Result<u64> {
            args.next()
                .with_context(|| format!("{name} needs a value"))?
                .parse()
                .with_context(|| format!("{name} is a number"))
        };
        match a.as_str() {
            "--mbps" => o.mbps = num("--mbps")?,
            "--fps" => o.fps = num("--fps")?,
            "--secs" => o.secs = num("--secs")?,
            other if target.is_none() && !other.starts_with("--") => target = Some(a),
            other => bail!("unknown argument {other}"),
        }
    }
    Ok((mode, target, o))
}

#[tokio::main]
async fn main() -> Result<()> {
    let (mode, target, o) = parse()?;
    match mode.as_str() {
        "loopback" => {
            let (hub, client) = (endpoint(true).await?, endpoint(false).await?);
            let addr = hub.addr();
            let accept = tokio::spawn(async move {
                let conn = hub.accept().await.context("accept")?.await?;
                Ok::<_, anyhow::Error>((hub, conn))
            });
            let rx = client.connect(addr, ALPN_VIDEO).await?;
            let (_hub, tx) = accept.await??;
            let r = tokio::spawn(receive(rx));
            send(tx, &o).await?;
            r.await??;
        }
        "serve" => {
            let hub = endpoint(true).await?;
            // Direct addresses are learned over the first moments.
            tokio::time::sleep(Duration::from_secs(1)).await;
            let addr = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&hub.addr())?);
            println!("connect with:\n{addr}");
            let conn = hub.accept().await.context("accept")?.await?;
            send(conn, &o).await?;
        }
        "connect" => {
            let addr = target.context("connect needs the address serve printed")?;
            let addr: iroh::EndpointAddr =
                serde_json::from_slice(&URL_SAFE_NO_PAD.decode(addr.as_bytes())?)?;
            let client = endpoint(false).await?;
            let conn = client.connect(addr, ALPN_VIDEO).await?;
            receive(conn).await?;
        }
        other => bail!("unknown mode {other}"),
    }
    Ok(())
}
