use std::os::unix::io::AsRawFd;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{UnixDatagram, UnixListener};
use tokio::sync::broadcast::error::RecvError;

use crate::session::SessionManager;
use nesprotocol::{CODEC_OPUS, STREAM_AUDIO, STREAM_VIDEO, decode_ipc_frame};

fn set_recv_buffer(socket: &UnixDatagram, size: libc::c_int) {
    unsafe {
        libc::setsockopt(
            socket.as_raw_fd(),
            libc::SOL_SOCKET,
            libc::SO_RCVBUF,
            &size as *const _ as *const libc::c_void,
            std::mem::size_of::<libc::c_int>() as libc::socklen_t,
        );
    }
}

pub async fn run_video_listener(socket_path: PathBuf, session_manager: Arc<SessionManager>) {
    if socket_path.exists() {
        let _ = std::fs::remove_file(&socket_path);
    }

    let socket = match UnixDatagram::bind(&socket_path) {
        Ok(s) => {
            let _ = std::fs::set_permissions(
                &socket_path,
                std::os::unix::fs::PermissionsExt::from_mode(0o666),
            );
            set_recv_buffer(&s, 4 * 1024 * 1024);
            s
        }
        Err(e) => {
            tracing::error!(
                "Failed to bind video IPC socket {}: {e}",
                socket_path.display()
            );
            return;
        }
    };

    tracing::info!("Video IPC listening on {}", socket_path.display());

    let mut buf = vec![0u8; 2 * 1024 * 1024];
    loop {
        match socket.recv(&mut buf).await {
            Ok(n) => {
                if let Some(decoded) = decode_ipc_frame(&buf[..n]) {
                    if decoded.stream_type != STREAM_VIDEO {
                        tracing::warn!(
                            "unexpected stream type on video socket: {}",
                            decoded.stream_type
                        );
                        continue;
                    }
                    let mut frame_data = Vec::with_capacity(1 + decoded.data.len());
                    frame_data.push(decoded.codec);
                    frame_data.push(decoded.flags);
                    frame_data.extend_from_slice(&decoded.timestamp_ms.to_le_bytes());
                    frame_data.extend_from_slice(&decoded.width.to_le_bytes());
                    frame_data.extend_from_slice(&decoded.height.to_le_bytes());
                    frame_data.extend_from_slice(decoded.data);

                    session_manager.broadcast_video(frame_data).await;
                } else {
                    tracing::warn!("invalid video IPC frame ({} bytes)", n);
                }
            }
            Err(e) => {
                tracing::error!("video IPC recv error: {e}");
                break;
            }
        }
    }

    tracing::info!("video IPC listener exited");
}

pub async fn run_audio_listener(socket_path: PathBuf, session_manager: Arc<SessionManager>) {
    if socket_path.exists() {
        let _ = std::fs::remove_file(&socket_path);
    }

    let socket = match UnixDatagram::bind(&socket_path) {
        Ok(s) => {
            let _ = std::fs::set_permissions(
                &socket_path,
                std::os::unix::fs::PermissionsExt::from_mode(0o666),
            );
            set_recv_buffer(&s, 4 * 1024 * 1024);
            s
        }
        Err(e) => {
            tracing::error!(
                "Failed to bind audio IPC socket {}: {e}",
                socket_path.display()
            );
            return;
        }
    };

    tracing::info!("Audio IPC listening on {}", socket_path.display());

    let mut buf = vec![0u8; 65536];
    loop {
        match socket.recv(&mut buf).await {
            Ok(n) => {
                if let Some(decoded) = decode_ipc_frame(&buf[..n]) {
                    if decoded.stream_type != STREAM_AUDIO {
                        tracing::warn!(
                            "unexpected stream type on audio socket: {}",
                            decoded.stream_type
                        );
                        continue;
                    }
                    if decoded.codec != CODEC_OPUS {
                        tracing::warn!("unexpected codec on audio socket: {}", decoded.codec);
                        continue;
                    }
                    let audio_data = decoded.data.to_vec();
                    session_manager.broadcast_audio(audio_data).await;
                } else {
                    tracing::warn!("invalid audio IPC frame ({} bytes)", n);
                }
            }
            Err(e) => {
                tracing::error!("audio IPC recv error: {e}");
                break;
            }
        }
    }

    tracing::info!("audio IPC listener exited");
}

pub async fn run_input_ipc_listener(
    socket_path: PathBuf,
    input_tx: tokio::sync::broadcast::Sender<Vec<u8>>,
    cursor_tx: tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
    nescope_stats_tx: tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
) {
    if socket_path.exists() {
        let _ = std::fs::remove_file(&socket_path);
    }

    let listener = match UnixListener::bind(&socket_path) {
        Ok(l) => {
            let _ = std::fs::set_permissions(
                &socket_path,
                std::os::unix::fs::PermissionsExt::from_mode(0o666),
            );
            l
        }
        Err(e) => {
            tracing::error!(
                "Failed to bind input IPC socket {}: {e}",
                socket_path.display()
            );
            return;
        }
    };

    tracing::info!("Input IPC listening on {}", socket_path.display());

    loop {
        match listener.accept().await {
            Ok((stream, peer_addr)) => {
                tracing::debug!(?peer_addr, "nescope connected to input IPC");
                if let Some(addr) = peer_addr.as_pathname() {
                    tracing::debug!(?addr, "nescope input IPC peer address");
                }

                let (mut read_half, mut write_half) = stream.into_split();
                let mut input_rx = input_tx.subscribe();
                let _c_tx = cursor_tx.clone();

                let write_handle = tokio::spawn(async move {
                    loop {
                        match input_rx.recv().await {
                            Ok(data) => {
                                let len = data.len() as u16;
                                let mut frame = Vec::with_capacity(2 + data.len());
                                frame.extend_from_slice(&len.to_le_bytes());
                                frame.extend_from_slice(&data);
                                if write_half.write_all(&frame).await.is_err() {
                                    tracing::debug!("input IPC write failed");
                                    break;
                                }
                            }
                            Err(RecvError::Lagged(n)) => {
                                tracing::warn!("input broadcast lagged by {n} messages");
                            }
                            Err(RecvError::Closed) => {
                                tracing::debug!("input broadcast closed");
                                break;
                            }
                        }
                    }
                });

                let c_tx = cursor_tx.clone();
                let ns_tx = nescope_stats_tx.clone();
                let read_handle = tokio::spawn(async move {
                    let mut len_buf = [0u8; 2];
                    loop {
                        if read_half.read_exact(&mut len_buf).await.is_err() {
                            break;
                        }
                        let len = u16::from_le_bytes(len_buf) as usize;
                        if len > 65535 {
                            break;
                        }
                        let mut payload = vec![0u8; len];
                        if read_half.read_exact(&mut payload).await.is_err() {
                            break;
                        }
                        // Route: cursor updates start with 0x80, stats start with 0x00-0x02
                        if !payload.is_empty()
                            && (payload[0] == nesprotocol::input::CURSOR_UPDATE
                                || payload[0] == nesprotocol::input::CURSOR_IMAGE)
                        {
                            let _ = c_tx.send(payload);
                        } else {
                            let _ = ns_tx.send(payload);
                        }
                    }
                });

                // When either task completes, the socket is broken.
                // The other task will finish naturally on the next I/O error.
                tokio::select! {
                    _ = write_handle => {}
                    _ = read_handle => {}
                }

                tracing::debug!("nescope disconnected from input IPC");
            }
            Err(e) => {
                tracing::error!("input IPC accept error: {e}");
                break;
            }
        }
    }

    tracing::info!("input IPC listener exited");
}

pub async fn run_stats_ipc_listener(
    socket_path: PathBuf,
    stats_tx: tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
) {
    if socket_path.exists() {
        let _ = std::fs::remove_file(&socket_path);
    }

    let socket = match UnixDatagram::bind(&socket_path) {
        Ok(s) => {
            let _ = std::fs::set_permissions(
                &socket_path,
                std::os::unix::fs::PermissionsExt::from_mode(0o666),
            );
            s
        }
        Err(e) => {
            tracing::error!(
                "Failed to bind stats IPC socket {}: {e}",
                socket_path.display()
            );
            return;
        }
    };

    tracing::info!("Stats IPC listening on {}", socket_path.display());

    let mut buf = vec![0u8; 256];
    loop {
        match socket.recv(&mut buf).await {
            Ok(n) => {
                let _ = stats_tx.send(buf[..n].to_vec());
            }
            Err(e) => {
                tracing::error!("stats IPC recv error: {e}");
                break;
            }
        }
    }

    tracing::info!("stats IPC listener exited");
}

pub async fn run_ticket_ipc_listener(socket_path: PathBuf, ticket: crate::NestriTicket) {
    if socket_path.exists() {
        let _ = std::fs::remove_file(&socket_path);
    }

    let listener = match UnixListener::bind(&socket_path) {
        Ok(l) => {
            let _ = std::fs::set_permissions(
                &socket_path,
                std::os::unix::fs::PermissionsExt::from_mode(0o666),
            );
            l
        }
        Err(e) => {
            tracing::error!(
                "Failed to bind ticket IPC socket {}: {e}",
                socket_path.display()
            );
            return;
        }
    };

    tracing::info!("ticket IPC listening on {}", socket_path.display());

    loop {
        match listener.accept().await {
            Ok((mut stream, _)) => {
                if let Err(e) = stream.write_all(format!("{ticket}\n").as_bytes()).await {
                    tracing::warn!("could not write ticket to IPC: {e}");
                }
            }
            Err(e) => {
                tracing::error!("ticket IPC accept error: {e}");
                break;
            }
        }
    }

    tracing::info!("ticket IPC listener exited");
}
