use std::collections::HashMap;
use std::sync::Arc;

use iroh::endpoint::Connection;
use tokio::sync::Mutex;
use tracing::{debug, info, warn};

use nesprotocol::datagram::{DGRAM_AUDIO, DGRAM_VIDEO};
use nesprotocol::input::{INPUT_KEY, INPUT_MOUSE_BUTTON, INPUT_MOUSE_MOVE, INPUT_MOUSE_WHEEL};
use nesprotocol::{BIDI_INPUT, STREAM_CURSOR, STREAM_STATS};
use nesprotocol::{FRAME_HDR_LEN, STREAM_VERSION, encode_frame};
use nesprotocol::{MSG_ENCODE_SETTINGS, MSG_IDR_REQUEST, MSG_INPUT_BATCH};

use crate::dgram::run_datagram_writer;

use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};

pub struct ClientSession {
    send_video: tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
    send_audio: tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
    send_cursor: tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
    send_stats: tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
    _video_task: tokio::task::JoinHandle<()>,
    _audio_task: tokio::task::JoinHandle<()>,
    _cursor_task: tokio::task::JoinHandle<()>,
    _stats_task: tokio::task::JoinHandle<()>,
    _input_task: tokio::task::JoinHandle<()>,
}

impl ClientSession {
    pub fn new(
        conn: Connection,
        input_broadcast: tokio::sync::broadcast::Sender<Vec<u8>>,
        relay_ms: Arc<AtomicU32>,
        idr_cmd_tx: tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
    ) -> Self {
        let (video_tx, video_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
        let (audio_tx, audio_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
        let (cursor_tx, cursor_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
        let (stats_tx, stats_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();

        // Delta frames and audio go out as datagrams; cursor, stats and input
        // stay on reliable streams. See `nestri_protocol::datagram` for why.
        //
        // Video keyframes are the exception: each goes on a reliable stream of
        // its own, because a lost keyframe freezes the picture until the next
        // one instead of costing a single frame. See
        // `nestri_protocol::reliable`. Audio is not offered the same path — it
        // has no keyframes to promote.
        let conn_v = conn.clone();
        let _video_task = tokio::spawn(async move {
            run_datagram_writer(conn_v, DGRAM_VIDEO, "video", video_rx, Some(relay_ms), true).await
        });

        let conn_a = conn.clone();
        let _audio_task = tokio::spawn(async move {
            run_datagram_writer(conn_a, DGRAM_AUDIO, "audio", audio_rx, None, false).await
        });

        let conn_c = conn.clone();
        let _cursor_task = tokio::spawn(async move { run_cursor_sender(conn_c, cursor_rx).await });

        let conn_s = conn.clone();
        let _stats_task = tokio::spawn(async move { run_stats_sender(conn_s, stats_rx).await });

        let conn_i = conn.clone();
        let _input_task =
            tokio::spawn(
                async move { run_input_reader(conn_i, input_broadcast, idr_cmd_tx).await },
            );

        Self {
            send_video: video_tx,
            send_audio: audio_tx,
            send_cursor: cursor_tx,
            send_stats: stats_tx,
            _video_task,
            _audio_task,
            _cursor_task,
            _stats_task,
            _input_task,
        }
    }

    pub fn send_video_frame(&self, data: Vec<u8>) {
        if let Err(e) = self.send_video.send(data) {
            warn!("failed to send video data: {e}");
        }
    }

    pub fn send_audio_packet(&self, data: Vec<u8>) {
        if let Err(e) = self.send_audio.send(data) {
            warn!("failed to send audio data: {e}");
        }
    }

    pub fn send_cursor_data(&self, data: Vec<u8>) {
        if let Err(e) = self.send_cursor.send(data) {
            warn!("failed to send cursor data: {e}");
        }
    }

    pub fn send_stats_data(&self, data: Vec<u8>) {
        if let Err(e) = self.send_stats.send(data) {
            warn!("failed to send stats data: {e}");
        }
    }
}

async fn run_input_reader(
    conn: Connection,
    input_broadcast: tokio::sync::broadcast::Sender<Vec<u8>>,
    idr_cmd_tx: tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
) {
    debug!("input reader started");
    loop {
        debug!("input reader opening bidi stream");
        match conn.open_bi().await {
            Ok((mut send, mut recv)) => {
                debug!("input bidi stream opened, writing type+version byte");
                if send.write_all(&[BIDI_INPUT, STREAM_VERSION]).await.is_err() {
                    debug!("input type byte write failed");
                    break;
                }
                let _ = send.finish();
                debug!("input bidi stream ready, reading framed events");

                loop {
                    // Read uniform frame: [4B len][1B type][2B seq][payload]
                    let mut len_buf = [0u8; 4];
                    if recv.read_exact(&mut len_buf).await.is_err() {
                        break;
                    }
                    let frame_len = u32::from_le_bytes(len_buf) as usize;
                    if frame_len < 3 || frame_len > 65536 {
                        break;
                    }
                    let mut frame = vec![0u8; frame_len];
                    if recv.read_exact(&mut frame).await.is_err() {
                        break;
                    }
                    let msg_type = frame[0];
                    let _seq = u16::from_le_bytes([frame[1], frame[2]]);
                    let payload = &frame[3..];

                    match msg_type {
                        MSG_INPUT_BATCH => {
                            let mut offset = 0;
                            while offset < payload.len() {
                                if offset + 1 > payload.len() {
                                    break;
                                }
                                match payload[offset] {
                                    INPUT_KEY => {
                                        if offset + 4 > payload.len() {
                                            break;
                                        }
                                        let raw = vec![
                                            INPUT_KEY,
                                            payload[offset + 1],
                                            payload[offset + 2],
                                            payload[offset + 3],
                                        ];
                                        let _ = input_broadcast.send(raw);
                                        offset += 4;
                                    }
                                    INPUT_MOUSE_MOVE => {
                                        if offset + 5 > payload.len() {
                                            break;
                                        }
                                        let mut raw = Vec::with_capacity(5);
                                        raw.push(INPUT_MOUSE_MOVE);
                                        raw.extend_from_slice(&payload[offset + 1..offset + 5]);
                                        let _ = input_broadcast.send(raw);
                                        offset += 5;
                                    }
                                    INPUT_MOUSE_BUTTON => {
                                        if offset + 3 > payload.len() {
                                            break;
                                        }
                                        let raw = vec![
                                            INPUT_MOUSE_BUTTON,
                                            payload[offset + 1],
                                            payload[offset + 2],
                                        ];
                                        let _ = input_broadcast.send(raw);
                                        offset += 3;
                                    }
                                    INPUT_MOUSE_WHEEL => {
                                        if offset + 5 > payload.len() {
                                            break;
                                        }
                                        let mut raw = Vec::with_capacity(5);
                                        raw.push(INPUT_MOUSE_WHEEL);
                                        raw.extend_from_slice(&payload[offset + 1..offset + 5]);
                                        let _ = input_broadcast.send(raw);
                                        offset += 5;
                                    }
                                    _ => {
                                        debug!("unknown input event type: {}", payload[offset]);
                                        break;
                                    }
                                }
                            }
                        }
                        MSG_IDR_REQUEST => {
                            info!("received IDR request from client");
                            let _ = idr_cmd_tx.send(vec![MSG_IDR_REQUEST]);
                        }
                        MSG_ENCODE_SETTINGS => {
                            info!(
                                "received encode settings from client ({} bytes)",
                                payload.len()
                            );
                            let mut cmd = Vec::with_capacity(1 + payload.len());
                            cmd.push(MSG_ENCODE_SETTINGS);
                            cmd.extend_from_slice(payload);
                            let _ = idr_cmd_tx.send(cmd);
                        }
                        _ => {
                            debug!("unknown bidi msg type: {}", msg_type);
                        }
                    }
                }
            }
            Err(e) => {
                debug!("input open_bi failed: {e}");
                break;
            }
        }
    }
    debug!("input reader exiting");
}

async fn run_cursor_sender(
    conn: Connection,
    mut rx: tokio::sync::mpsc::UnboundedReceiver<Vec<u8>>,
) {
    loop {
        let first = match rx.recv().await {
            Some(data) => data,
            None => {
                debug!("cursor sender exiting (channel closed)");
                return;
            }
        };

        let mut send = match conn.open_uni().await {
            Ok(s) => s,
            Err(e) => {
                debug!("cursor open_uni failed: {e}");
                break;
            }
        };
        debug!("cursor uni stream opened");

        if send
            .write_all(&[STREAM_CURSOR, STREAM_VERSION])
            .await
            .is_err()
        {
            let _ = send.finish();
            break;
        }

        let msg_type = if first.is_empty() { 0 } else { first[0] };
        let payload = if first.len() > 1 { &first[1..] } else { &[] };
        let mut buf = Vec::with_capacity(FRAME_HDR_LEN + first.len());
        encode_frame(&mut buf, msg_type, 0, payload);
        if send.write_all(&buf).await.is_err() {
            let _ = send.finish();
            break;
        }

        let mut sent: u64 = 1;
        loop {
            match rx.recv().await {
                Some(bytes) => {
                    sent += 1;
                    if sent <= 3 {
                        debug!(
                            "cursor sender: sending update #{sent} ({} bytes)",
                            bytes.len()
                        );
                    }
                    buf.clear();
                    let mt = if bytes.is_empty() { 0 } else { bytes[0] };
                    let p = if bytes.len() > 1 { &bytes[1..] } else { &[] };
                    encode_frame(&mut buf, mt, 0, p);
                    if send.write_all(&buf).await.is_err() {
                        break;
                    }
                }
                None => {
                    let _ = send.finish();
                    debug!("cursor sender exiting (channel closed)");
                    return;
                }
            }
        }
        let _ = send.finish();
    }
    debug!("cursor sender exiting");
}

async fn run_stats_sender(conn: Connection, mut rx: tokio::sync::mpsc::UnboundedReceiver<Vec<u8>>) {
    loop {
        let first = match rx.recv().await {
            Some(data) => data,
            None => {
                debug!("stats sender exiting (channel closed)");
                return;
            }
        };
        let mut send = match conn.open_uni().await {
            Ok(s) => s,
            Err(e) => {
                debug!("stats open_uni failed: {e}");
                break;
            }
        };
        debug!("stats uni stream opened");
        if send
            .write_all(&[STREAM_STATS, STREAM_VERSION])
            .await
            .is_err()
        {
            let _ = send.finish();
            break;
        }

        let st = if first.is_empty() { 0 } else { first[0] };
        let payload = if first.len() > 1 { &first[1..] } else { &[] };
        let mut buf = Vec::with_capacity(FRAME_HDR_LEN + first.len());
        encode_frame(&mut buf, st, 0, payload);
        if send.write_all(&buf).await.is_err() {
            let _ = send.finish();
            break;
        }

        loop {
            match rx.recv().await {
                Some(bytes) => {
                    buf.clear();
                    let mt = if bytes.is_empty() { 0 } else { bytes[0] };
                    let p = if bytes.len() > 1 { &bytes[1..] } else { &[] };
                    encode_frame(&mut buf, mt, 0, p);
                    if send.write_all(&buf).await.is_err() {
                        break;
                    }
                }
                None => {
                    let _ = send.finish();
                    debug!("stats sender exiting (channel closed)");
                    return;
                }
            }
        }
        let _ = send.finish();
    }
    debug!("stats sender exiting");
}

pub struct SessionManager {
    sessions: Arc<Mutex<HashMap<iroh::EndpointId, ClientSession>>>,
    video_bytes: AtomicU64,
    last_video_bytes: AtomicU64,
    video_bitrate: AtomicU64, // bytes/sec
    audio_bytes: AtomicU64,
    last_audio_bytes: AtomicU64,
    relay_ms: Arc<AtomicU32>, // latest relay latency (f32 bits)
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            video_bytes: AtomicU64::new(0),
            last_video_bytes: AtomicU64::new(0),
            video_bitrate: AtomicU64::new(0),
            audio_bytes: AtomicU64::new(0),
            last_audio_bytes: AtomicU64::new(0),
            relay_ms: Arc::new(AtomicU32::new(0)),
        }
    }

    pub async fn add_session(&self, id: iroh::EndpointId, session: ClientSession) {
        let mut sessions = self.sessions.lock().await;
        sessions.insert(id, session);
        info!(remote = %id.fmt_short(), "client session added ({} total)", sessions.len());
    }

    pub async fn remove_session(&self, id: &iroh::EndpointId) {
        let mut sessions = self.sessions.lock().await;
        sessions.remove(id);
        info!(remote = %id.fmt_short(), "client session removed ({} remaining)", sessions.len());
    }

    pub async fn broadcast_video(&self, data: Vec<u8>) {
        self.video_bytes
            .fetch_add(data.len() as u64, Ordering::Relaxed);
        let sessions = self.sessions.lock().await;
        if sessions.is_empty() {
            return;
        }
        for session in sessions.values() {
            session.send_video_frame(data.clone());
        }
    }

    pub async fn broadcast_audio(&self, data: Vec<u8>) {
        // Counted before the early return, so the figure measures what neswire
        // delivered rather than what a client happened to be around for. A hub
        // with no client still knows whether audio is being produced.
        self.audio_bytes
            .fetch_add(data.len() as u64, Ordering::Relaxed);
        let sessions = self.sessions.lock().await;
        if sessions.is_empty() {
            return;
        }
        for session in sessions.values() {
            session.send_audio_packet(data.clone());
        }
    }

    pub async fn broadcast_cursor(&self, data: Vec<u8>) {
        let sessions = self.sessions.lock().await;
        if sessions.is_empty() {
            return;
        }
        for session in sessions.values() {
            session.send_cursor_data(data.clone());
        }
    }

    pub async fn broadcast_stats(&self, data: Vec<u8>) {
        let sessions = self.sessions.lock().await;
        if sessions.is_empty() {
            return;
        }
        for session in sessions.values() {
            session.send_stats_data(data.clone());
        }
    }

    pub fn relay_ms(&self) -> f32 {
        f32::from_bits(self.relay_ms.swap(0, Ordering::Relaxed))
    }

    pub fn relay_ms_atomic(&self) -> Arc<AtomicU32> {
        self.relay_ms.clone()
    }

    pub async fn client_count(&self) -> usize {
        self.sessions.lock().await.len()
    }

    /// Opus actually received from neswire since the last call, in kbps.
    ///
    /// Measured, not configured. The reported figure used to be
    /// `channels * bitrate_per_channel` straight off the hub's own command line,
    /// which is a constant: it read 128 kbps whether neswire was feeding the
    /// socket, feeding it silence, or had never sent a byte. A stat that cannot
    /// be wrong cannot be evidence of anything.
    ///
    /// Like [`video_bitrate_bps`], this assumes the caller ticks once a second
    /// -- the difference since the previous call *is* the per-second figure.
    ///
    /// [`video_bitrate_bps`]: Self::video_bitrate_bps
    pub fn audio_bitrate_kbps(&self) -> u32 {
        let current = self.audio_bytes.load(Ordering::Relaxed);
        let last = self.last_audio_bytes.swap(current, Ordering::Relaxed);
        let diff = current.saturating_sub(last);
        (diff * 8 / 1000) as u32
    }

    pub fn video_bitrate_bps(&self) -> u32 {
        let current = self.video_bytes.load(Ordering::Relaxed);
        let last = self.last_video_bytes.swap(current, Ordering::Relaxed);
        let diff = current.saturating_sub(last);
        self.video_bitrate.store(diff, Ordering::Relaxed);
        (diff * 8) as u32 // bits per second
    }
}
