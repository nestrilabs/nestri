mod control;
mod dgram;
mod ipc_listener;
mod keyframe;
mod screenshot;
mod session;
mod ticket;

use std::path::PathBuf;
use std::sync::Arc;

use anyhow::Result;
use clap::Parser;
use iroh::endpoint::presets;

use crate::session::SessionManager;
use crate::ticket::NestriTicket;
use nesprotocol::{ALPNS, Carrier};

#[derive(Parser, Debug)]
#[command(name = "neshub")]
struct Args {
    /// Relay mode: default, none, or a custom relay URL
    #[arg(long, env = "NESTRI_RELAY", default_value = "default")]
    relay: String,

    /// Path for the video IPC socket (nescapture → neshub)
    #[arg(
        long,
        env = "NESTRI_VIDEO_IPC",
        default_value = "/tmp/nestri-video.sock"
    )]
    video_ipc: PathBuf,

    /// Path for the audio IPC socket (neswire → neshub)
    #[arg(
        long,
        env = "NESTRI_AUDIO_IPC",
        default_value = "/tmp/nestri-audio.sock"
    )]
    audio_ipc: PathBuf,

    /// Path for the input IPC socket (neshub → nescope).
    #[arg(
        long,
        env = "NESTRI_INPUT_IPC",
        default_value = "/tmp/nestri-input.sock"
    )]
    input_ipc: PathBuf,

    /// Path for the stats IPC socket (nescapture → neshub stats).
    #[arg(
        long,
        env = "NESTRI_STATS_IPC",
        default_value = "/tmp/nestri-stats.sock"
    )]
    stats_ipc: PathBuf,

    /// Socket the ticket is served on. neshub listens; nesinit dials and
    /// carries the ticket to the host, because the person who needs it is
    /// outside this VM and stdout here is a log file inside one.
    #[arg(
        long,
        env = "NESTRI_TICKET_IPC",
        default_value = "/tmp/nestri-ticket.sock"
    )]
    ticket_ipc: PathBuf,

    /// Audio channels (from neswire config): 2 = stereo, 6 = 5.1, 8 = 7.1
    #[arg(long, env = "NESTRI_AUDIO_CHANNELS", default_value_t = 2)]
    audio_channels: u32,

    /// Audio bitrate per channel in kbps
    #[arg(long, env = "NESTRI_AUDIO_BITRATE", default_value_t = 64)]
    audio_bitrate_per_channel: u32,

    /// Ceiling on the video bitrate, in kbps.
    ///
    /// Set by `nesinit` from the boot descriptor's video limits, which come
    /// from the tier the box was sized for. Absent means nobody said -- which is
    /// not a licence to send whatever the encoder defaults to, since that is
    /// precisely how every session came to offer 10 Mbps regardless of what the
    /// path could carry. Unset is reported, and a conservative ceiling is used.
    #[arg(long, env = "NESTRI_MAX_BITRATE")]
    max_bitrate_kbps: Option<u32>,

    /// Socket nescope sends screenshots on. neshub listens; nescope dials out.
    #[arg(
        long,
        env = "NESTRI_SCREENSHOT_IPC",
        default_value = "/tmp/nestri-screenshot.sock"
    )]
    screenshot_ipc: PathBuf,
}

/// What to assume when nobody said.
///
/// Deliberately modest. A ceiling that was never set should not behave like an
/// unlimited one: the whole failure this exists to fix was a session offering
/// 10 Mbps into a path carrying under three, because no number had ever been
/// chosen and the encoder's own default stood in for one.
const DEFAULT_MAX_BITRATE_KBPS: u32 = 4_000;

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    let args = Args::parse();

    let mut builder = iroh::Endpoint::builder(presets::N0)
        .alpns(ALPNS.iter().map(|a| a.to_vec()).collect::<Vec<_>>())
        .transport_config(crate::dgram::media_transport_config());

    match args.relay.as_str() {
        "default" | "" => {
            builder = builder.relay_mode(iroh::endpoint::RelayMode::Default);
            tracing::info!("using default n0-computer relays");
        }
        "none" | "off" | "disabled" => {
            builder = builder.relay_mode(iroh::endpoint::RelayMode::Disabled);
            tracing::info!("relays disabled (direct connections only)");
        }
        url => {
            let relay_url: iroh::RelayUrl = url.parse()?;
            let relay_map = iroh::RelayMap::empty();
            relay_map.insert(
                relay_url.clone(),
                Arc::new(iroh::RelayConfig::new(relay_url, None)),
            );
            builder = builder.relay_mode(iroh::endpoint::RelayMode::Custom(relay_map));
            tracing::info!("using custom relay: {url}");
        }
    }

    match args.max_bitrate_kbps {
        Some(kbps) => tracing::info!("video ceiling: {kbps} kbps, from the boot descriptor"),
        None => tracing::warn!(
            "no video ceiling on the boot descriptor; using {DEFAULT_MAX_BITRATE_KBPS} kbps. \
             A box sized by a tier is told its ceiling -- if this is one, the descriptor did \
             not carry it."
        ),
    }

    let endpoint = builder.bind().await?;
    let endpoint_addr = endpoint.addr();
    let ep_id = endpoint_addr.id;
    tracing::info!("endpoint online: {}", ep_id.fmt_short());

    // Input broadcast channel: input reader -> input IPC listener -> nescope
    let (input_broadcast_tx, _) = tokio::sync::broadcast::channel::<Vec<u8>>(256);

    // Cursor channel: IPC listener (read side) -> client sessions -> desktop-app
    let (cursor_tx, mut cursor_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();

    // Nescope stats channel: IPC listener -> client sessions
    let (nescope_stats_tx, mut nescope_stats_rx) =
        tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();

    let session_manager = Arc::new(SessionManager::new());

    // One controller for the box, not one per client: there is one encoder, so
    // there is one bitrate, and the client having the worst time is the one it
    // has to answer.
    let box_ceiling_kbps = args.max_bitrate_kbps.unwrap_or(DEFAULT_MAX_BITRATE_KBPS);
    let controller = Arc::new(tokio::sync::Mutex::new(control::Controller::new(
        control::Limits::new(box_ceiling_kbps),
    )));

    // IDR / encode settings command channel: input reader → nescapture
    let (cmd_tx, mut cmd_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
    {
        tokio::spawn(async move {
            let cmd_path = std::path::PathBuf::from("/tmp/nescapture-cmd.sock");
            while let Some(bytes) = cmd_rx.recv().await {
                if let Ok(sock) = std::os::unix::net::UnixDatagram::unbound() {
                    if sock.send_to(&bytes, &cmd_path).is_err() {
                        tracing::warn!("nescapture cmd send failed at {}", cmd_path.display());
                    }
                }
            }
        });
    }

    // Spawn cursor relay
    {
        let mgr = session_manager.clone();
        tokio::spawn(async move {
            while let Some(data) = cursor_rx.recv().await {
                mgr.broadcast_cursor(data).await;
            }
        });
    }

    // Spawn nescope stats relay
    {
        let mgr = session_manager.clone();
        tokio::spawn(async move {
            while let Some(data) = nescope_stats_rx.recv().await {
                mgr.broadcast_stats(data).await;
            }
        });
    }

    // Spawn periodic hub stats
    {
        let mgr = session_manager.clone();
        let audio_channels = args.audio_channels as u8;
        // The configured target is worth saying once, here, where it is a fact
        // about this hub's arguments. It is deliberately not what gets reported
        // in the stats below -- see `SessionManager::audio_bitrate_kbps`.
        tracing::info!(
            "audio configured for {}ch at {}kbps/channel; stats report measured ingest",
            args.audio_channels,
            args.audio_bitrate_per_channel
        );
        let controller = controller.clone();
        let cmd_tx = cmd_tx.clone();
        tokio::spawn(async move {
            // Ten times a second, and only when asked for. Pairs with
            // nescapture's rate probe: that measures how fast the encoder
            // follows a new bitrate, this shows how fast the queue downstream
            // of it responds, and the slower of the two is the fastest a
            // control loop can usefully run. At one sample a second neither is
            // visible -- a queue that fills and drains inside a second looks
            // like a queue that was never there.
            if std::env::var("NESHUB_BACKLOG_TRACE").is_ok_and(|v| v != "0" && !v.is_empty()) {
                let mgr = mgr.clone();
                let controller = controller.clone();
                tokio::spawn(async move {
                    let mut fast =
                        tokio::time::interval(std::time::Duration::from_millis(100));
                    tracing::info!("backlog trace on, 10 Hz");
                    loop {
                        fast.tick().await;
                        let backlogs = mgr.backlog_bytes().await;
                        if backlogs.is_empty() {
                            continue;
                        }
                        let target = controller.lock().await.target_kbps();
                        for bytes in backlogs {
                            // Against the target rather than a measured drain:
                            // this is a trace to read afterwards, and a number
                            // divided by a second measurement is two things
                            // moving at once.
                            let ms = bytes.saturating_mul(8) / u64::from(target.max(1));
                            tracing::info!("backlog {ms} ms ({bytes} bytes) at {target} kbps");
                        }
                    }
                });
            }

            let mut interval = tokio::time::interval(std::time::Duration::from_secs(1));
            loop {
                interval.tick().await;

                // One decision a second, on the same tick as the stats, because
                // a report describes the second that just passed and there is
                // nothing to gain from deciding more often than they arrive.
                {
                    let clients = mgr.client_count().await;
                    let (report, path, self_inflicted) = mgr.worst_report().await;
                    let mut controller = controller.lock().await;
                    if let Some(kbps) = controller.tick(clients, report, path, self_inflicted) {
                        let mut cmd = vec![nesprotocol::MSG_ENCODE_SETTINGS];
                        nesprotocol::encode_bitrate_only(&mut cmd, kbps);
                        if cmd_tx.send(cmd).is_err() {
                            tracing::warn!("encoder command channel closed");
                        } else {
                            // Trace, not info: under a path that keeps moving
                            // this fires every second, and a per-second line at
                            // info buries everything worth reading.
                            tracing::trace!(
                                "video ceiling {}/{} kbps: {:?}",
                                kbps,
                                controller.limits().ceiling_kbps,
                                controller.reason(),
                            );
                        }
                    }
                }

                let clients = mgr.client_count().await as u8;
                let (key_bps, delta_bps, keyframes) = mgr.video_breakdown();
                let (pipeline_p50_ms, pipeline_p95_ms, pipeline_max_ms) = mgr.pipeline_delays();
                let audio_kbps = mgr.audio_bitrate_kbps();
                let relay_ms = mgr.relay_ms();
                let mut buf = Vec::with_capacity(34);
                nesprotocol::stats::encode_hub_stats(
                    &mut buf,
                    clients,
                    key_bps.saturating_add(delta_bps),
                    relay_ms,
                    audio_kbps,
                    audio_channels,
                );
                {
                    let controller = controller.lock().await;
                    nesprotocol::stats::encode_video_breakdown(
                        &mut buf,
                        &nesprotocol::stats::VideoBreakdown {
                            key_bps,
                            delta_bps,
                            keyframes,
                            target_kbps: controller.target_kbps(),
                            ceiling_kbps: controller.limits().ceiling_kbps,
                            reason: controller.reason() as u8,
                            manual: u8::from(controller.mode() == nesprotocol::ControlMode::Manual),
                            box_ceiling_kbps: controller.box_ceiling_kbps(),
                            pipeline_p50_ms,
                            pipeline_p95_ms,
                            pipeline_max_ms,
                            backlog_ms: controller.backlog_ms().min(u32::from(u16::MAX)) as u16,
                        },
                    );
                }
                mgr.broadcast_stats(buf).await;
            }
        });
    }

    // ── Accept mode: generate ticket, wait for desktop-app to connect ─────
    let stream_name = ticket::generate_stream_name();
    // For the log line below only. What a reader of the socket gets is built
    // per read from the endpoint itself, because the addresses this can be
    // reached at are not all known yet.
    let ticket = NestriTicket::new(endpoint_addr, stream_name.clone());

    tracing::info!("╔═══════════════╗");
    tracing::info!("║ NESTRI TICKET ║");
    tracing::info!("╚═══════════════╝");
    tracing::info!("{ticket}\n");

    // Spawn IPC listeners

    let video_ipc = args.video_ipc.clone();
    let audio_ipc = args.audio_ipc.clone();
    let input_ipc = args.input_ipc.clone();
    let stats_ipc = args.stats_ipc.clone();
    let stats_tx_clone = nescope_stats_tx.clone();
    tokio::spawn({
        let mgr = session_manager.clone();
        async move { ipc_listener::run_video_listener(video_ipc, mgr).await }
    });
    tokio::spawn({
        let mgr = session_manager.clone();
        async move { ipc_listener::run_audio_listener(audio_ipc, mgr).await }
    });
    let input_ipc_tx = input_broadcast_tx.clone();
    let cursor_ipc_tx = cursor_tx.clone();
    let ns_tx = nescope_stats_tx.clone();
    tokio::spawn({
        async move {
            ipc_listener::run_input_ipc_listener(input_ipc, input_ipc_tx, cursor_ipc_tx, ns_tx)
                .await
        }
    });
    tokio::spawn({
        let stx = stats_tx_clone.clone();
        async move { ipc_listener::run_stats_ipc_listener(stats_ipc, stx).await }
    });

    let ticket_ipc = args.ticket_ipc.clone();
    tokio::spawn({
        // The endpoint rather than a ticket made from it: the addresses it can
        // be reached at are not all known yet, and whoever reads this socket
        // re-reads it so that a better one can replace the first.
        let endpoint = endpoint.clone();
        let stream_name = stream_name.clone();
        async move { ipc_listener::run_ticket_ipc_listener(ticket_ipc, endpoint, stream_name).await }
    });

    // Accept loop
    let ep = endpoint.clone();
    let mgr = session_manager.clone();
    let accept_handle = tokio::spawn(async move {
        while let Some(incoming) = ep.accept().await {
            match incoming.await {
                Ok(conn) => {
                    let remote_id = conn.remote_id();
                    // A client opens one connection per kind of traffic, so the
                    // ALPN says which this is and the endpoint id says whose.
                    let Some(carrier) = Carrier::from_alpn(conn.alpn()) else {
                        tracing::warn!(
                            remote = %remote_id.fmt_short(),
                            "connection with an unknown ALPN; closing"
                        );
                        conn.close(0u32.into(), b"unknown alpn");
                        continue;
                    };
                    tracing::info!(
                        remote = %remote_id.fmt_short(),
                        carrier = carrier.label(),
                        "client connected"
                    );
                    mgr.attach(
                        remote_id,
                        carrier,
                        conn.clone(),
                        input_broadcast_tx.clone(),
                        cmd_tx.clone(),
                        controller.clone(),
                    )
                    .await;
                    let mgr_clone = mgr.clone();
                    tokio::spawn(async move {
                        conn.closed().await;
                        // Any one of them going means the session goes. A client
                        // left holding audio and input but no video is not a
                        // degraded session, it is a stuck one, and a clean
                        // reconnect is both simpler to reason about and quicker
                        // than whatever partial recovery would be built here.
                        tracing::debug!(
                            remote = %remote_id.fmt_short(),
                            carrier = carrier.label(),
                            "carrier closed, ending session"
                        );
                        mgr_clone.remove_session(&remote_id).await;
                    });
                }
                Err(e) => {
                    tracing::warn!("incoming connection failed: {e}");
                }
            }
        }
        tracing::info!("accept loop exited");
    });

    // Not wired to anything today. Kept because the capture works and "show me
    // what the guest is displaying" is the first question when a payload
    // renders black.
    let _screenshots = match screenshot::listen(&args.screenshot_ipc) {
        Ok(connection) => Some(connection),
        Err(e) => {
            tracing::warn!("screenshots unavailable: {e:#}");
            None
        }
    };

    tracing::info!("neshub running, ctrl+c to stop");
    tokio::signal::ctrl_c().await?;
    tracing::info!("shutting down..");
    endpoint.close().await;
    accept_handle.abort();

    let _ = std::fs::remove_file(&args.video_ipc);
    let _ = std::fs::remove_file(&args.audio_ipc);
    let _ = std::fs::remove_file(&args.input_ipc);
    let _ = std::fs::remove_file(&args.stats_ipc);
    let _ = std::fs::remove_file("/tmp/nescapture-cmd.sock");
    let _ = std::fs::remove_file(&args.ticket_ipc);
    Ok(())
}
