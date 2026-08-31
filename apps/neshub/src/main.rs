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
use nesprotocol::ALPN;

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

    /// Socket nescope sends screenshots on. neshub listens; nescope dials out.
    #[arg(
        long,
        env = "NESTRI_SCREENSHOT_IPC",
        default_value = "/tmp/nestri-screenshot.sock"
    )]
    screenshot_ipc: PathBuf,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::builder()
                .with_default_directive(tracing_subscriber::filter::LevelFilter::INFO.into())
                .from_env_lossy(),
        )
        .init();

    let args = Args::parse();

    let mut builder = iroh::Endpoint::builder(presets::N0)
        .alpns(vec![ALPN.to_vec()])
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
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(1));
            loop {
                interval.tick().await;
                let clients = mgr.client_count().await as u8;
                let bitrate = mgr.video_bitrate_bps();
                let audio_kbps = mgr.audio_bitrate_kbps();
                let relay_ms = mgr.relay_ms();
                let mut buf = Vec::with_capacity(15);
                nesprotocol::stats::encode_hub_stats(
                    &mut buf,
                    clients,
                    bitrate,
                    relay_ms,
                    audio_kbps,
                    audio_channels,
                );
                mgr.broadcast_stats(buf).await;
            }
        });
    }

    // ── Accept mode: generate ticket, wait for desktop-app to connect ─────
    let stream_name = ticket::generate_stream_name();
    let ticket = NestriTicket::new(endpoint_addr, stream_name);

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
        async move { ipc_listener::run_ticket_ipc_listener(ticket_ipc, ticket).await }
    });

    // Accept loop
    let ep = endpoint.clone();
    let mgr = session_manager.clone();
    let accept_handle = tokio::spawn(async move {
        while let Some(incoming) = ep.accept().await {
            match incoming.await {
                Ok(conn) => {
                    let remote_id = conn.remote_id();
                    tracing::info!(remote = %remote_id.fmt_short(), "client connected");
                    let session = session::ClientSession::new(
                        conn.clone(),
                        input_broadcast_tx.clone(),
                        session_manager.relay_ms_atomic(),
                        cmd_tx.clone(),
                    );
                    mgr.add_session(remote_id, session).await;
                    let mgr_clone = mgr.clone();
                    let conn_clone = conn.clone();
                    tokio::spawn(async move {
                        conn_clone.closed().await;
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
