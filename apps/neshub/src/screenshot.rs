//! Asking nescope what is on screen.
//!
//! neshub is the listener and nescope dials out, the same way the input socket
//! works — so this waits for a connection rather than making one, and there is
//! no race against a compositor that has not started yet.
//!
//! Nothing here interprets the pixels. It is transport only -- whatever asked
//! for the picture decides what it means.
//!
//! **Nothing calls this today.** It was neshub's half of a login-QR capture,
//! and that path is gone -- nessh's own token signs the client in, so no
//! screenshot is needed to sign anybody in. It is kept because the capture
//! works and "show me what the guest is displaying" is the first question when
//! a payload renders black; `nescope-shot` covers the same ground from the
//! other side. Wire it to a control message or delete it, but do not leave it
//! half-connected.
#![allow(dead_code)]

use std::path::Path;
use std::sync::Arc;

use anyhow::{Context, Result};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::Mutex;

/// Ask for a picture of what is on screen.
const REQUEST_CAPTURE: u8 = 0x01;

/// Status bytes, as `nescope::screenshot_wire` defines them.
const STATUS_OK: u8 = 0;

/// The connection nescope made, once it has made one.
///
/// Held across captures rather than reconnecting: nescope connects once and
/// serves every request on that connection, so dropping it would mean nothing
/// could ask again.
pub type Connection = Arc<Mutex<Option<UnixStream>>>;

/// Listen for nescope, and keep the connection for whoever asks later.
///
/// Returns as soon as the socket is bound, not when nescope connects — the
/// caller has other things to start, and a compositor that never dials is a
/// failure the first capture reports rather than one that blocks startup.
pub fn listen(path: &Path) -> Result<Connection> {
    // A stale socket file makes bind fail with EADDRINUSE, which reads as
    // "something is already listening" when nothing is.
    let _ = std::fs::remove_file(path);
    let listener = UnixListener::bind(path)
        .with_context(|| format!("could not listen on {}", path.display()))?;
    tracing::info!("listening for nescope screenshots on {}", path.display());

    let connection: Connection = Arc::new(Mutex::new(None));
    let slot = Arc::clone(&connection);
    tokio::spawn(async move {
        loop {
            match listener.accept().await {
                Ok((stream, _)) => {
                    tracing::info!("nescope connected for screenshots");
                    *slot.lock().await = Some(stream);
                }
                Err(e) => {
                    tracing::warn!("accepting a screenshot connection failed: {e}");
                    return;
                }
            }
        }
    });
    Ok(connection)
}

/// One capture. `None` means nescope had nothing to show, which is not an
/// error — a client that has not drawn yet is the normal case while waiting.
pub async fn capture_on(connection: &Connection) -> Result<Option<(u32, u32, Vec<u8>)>> {
    let mut guard = connection.lock().await;
    let Some(stream) = guard.as_mut() else {
        anyhow::bail!("nescope has not connected for screenshots yet");
    };

    stream
        .write_all(&[REQUEST_CAPTURE])
        .await
        .context("could not ask nescope for a capture")?;

    let mut header = [0u8; 9];
    stream
        .read_exact(&mut header)
        .await
        .context("nescope did not answer a capture request")?;

    if header[0] != STATUS_OK {
        // Every non-Ok status means "no pixels", and the distinctions between
        // them are a debugging matter for `nescope-shot` rather than anything
        // this can act on differently.
        return Ok(None);
    }
    let width = u32::from_le_bytes(header[1..5].try_into().unwrap());
    let height = u32::from_le_bytes(header[5..9].try_into().unwrap());
    let mut rgba = vec![0u8; (width as usize) * (height as usize) * 4];
    stream
        .read_exact(&mut rgba)
        .await
        .context("a capture was cut short")?;
    Ok(Some((width, height, rgba)))
}
