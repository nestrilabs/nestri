//! nesgamepad: the controllers plugged into a client, as devices in the box.
//!
//! The hub forwards what each client says about its controllers, tagged with
//! which client, and this makes a virtual device for each one a game can find
//! the way it finds real hardware: an evdev node, announced through libudev.
//! Rumble a game asks for goes back the same way.
//!
//! Idle until the first controller arrives. A box with none connected has no
//! devices at all, which matters: some games stop listening to the keyboard
//! and mouse the moment a controller exists.
//!
//! Runs as root, for three things nothing else can grant: creating devices
//! through `/dev/uinput`, opening their nodes to the workload, and sending the
//! udev broadcast, whose receivers drop anything not sent by uid 0.

#[cfg(test)]
mod kernel_tests;
mod layout;
mod pads;
mod udev;
mod uinput;

use std::path::PathBuf;
use std::time::Duration;

use anyhow::Result;
use clap::Parser;
use nesprotocol::gamepad::{PadMessage, decode_ipc, encode_ipc};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::UnixStream;
use tracing::{debug, info, warn};

use crate::pads::{Feedback, Pads};

#[derive(Parser, Debug)]
#[command(name = "nesgamepad")]
struct Args {
    /// The hub's gamepad socket. The hub listens; this dials.
    #[arg(
        long,
        env = "NESTRI_GAMEPAD_IPC",
        default_value = "/tmp/nestri-gamepad.sock"
    )]
    ipc: PathBuf,
}

/// How long to wait before dialling the hub again.
const REDIAL: Duration = Duration::from_secs(1);

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();
    let args = Args::parse();

    // Without it the devices still exist, and nothing that finds devices
    // through libudev can see them -- which is almost everything. Said loudly
    // and carried on with, because a box that at least makes the device is
    // easier to diagnose than one that refused to start.
    let udev = match udev::Udev::new() {
        Ok(udev) => Some(udev),
        Err(e) => {
            warn!("cannot stand in for udev, so games will not find controllers: {e}");
            None
        }
    };

    let (feedback_tx, mut feedback_rx) = tokio::sync::mpsc::unbounded_channel::<Feedback>();
    let mut pads = Pads::new(udev, feedback_tx);
    info!("waiting for the hub on {}", args.ipc.display());

    let mut failures = 0u32;
    loop {
        let stream = match UnixStream::connect(&args.ipc).await {
            Ok(stream) => stream,
            Err(e) => {
                // Once at warn, and after that at debug: the hub starting a
                // little later than this is normal, and a line a second while
                // it does is noise.
                if failures == 0 {
                    warn!("hub not reachable at {} yet: {e}", args.ipc.display());
                } else {
                    debug!("hub still not reachable: {e}");
                }
                failures += 1;
                tokio::time::sleep(REDIAL).await;
                continue;
            }
        };
        failures = 0;
        info!("connected to the hub");
        if let Err(e) = serve(stream, &mut pads, &mut feedback_rx).await {
            debug!("hub connection ended: {e}");
        }
        // Every controller belonged to a client of that hub, and the hub has
        // gone -- so have they. Leaving them would leave a game holding
        // controllers that nobody is on the other end of.
        pads.clear();
        // Rumble queued for clients that no longer exist.
        while feedback_rx.try_recv().is_ok() {}
        info!("lost the hub; every controller unplugged");
        tokio::time::sleep(REDIAL).await;
    }
}

async fn serve(
    stream: UnixStream,
    pads: &mut Pads,
    feedback: &mut tokio::sync::mpsc::UnboundedReceiver<Feedback>,
) -> Result<()> {
    let (mut read, mut write) = stream.into_split();
    // Reading on a task of its own: a read of a frame is several awaits, and
    // one cancelled halfway by rumble arriving would lose the framing for
    // good.
    let (tx, mut messages) = tokio::sync::mpsc::unbounded_channel::<(u32, PadMessage)>();
    let reader = tokio::spawn(async move {
        let mut len_buf = [0u8; 2];
        loop {
            read.read_exact(&mut len_buf).await?;
            let mut body = vec![0u8; u16::from_le_bytes(len_buf) as usize];
            read.read_exact(&mut body).await?;
            let Some((session, message)) = decode_ipc(&body) else {
                debug!("short frame from the hub");
                continue;
            };
            match PadMessage::decode(message) {
                Some(message) => {
                    if tx.send((session, message)).is_err() {
                        return Ok::<_, std::io::Error>(());
                    }
                }
                None => debug!(session, "a gamepad message this does not understand"),
            }
        }
    });
    let result = loop {
        tokio::select! {
            message = messages.recv() => match message {
                Some((session, message)) => pads.handle(session, message),
                None => break Ok(()),
            },
            Some((session, message)) = feedback.recv() => {
                let mut body = Vec::with_capacity(8);
                message.encode(&mut body);
                let mut frame = Vec::with_capacity(16);
                encode_ipc(&mut frame, session, &body);
                if let Err(e) = write.write_all(&frame).await {
                    break Err(e.into());
                }
            }
        }
    };
    reader.abort();
    result
}
