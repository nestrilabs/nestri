use std::collections::HashMap;
use std::sync::Arc;

use iroh::endpoint::Connection;
use tokio::sync::Mutex;
use tracing::{debug, info};

use nesprotocol::datagram::{DGRAM_AUDIO, DGRAM_BUFFER_BYTES, DGRAM_VIDEO};
use nesprotocol::input::{INPUT_KEY, INPUT_MOUSE_BUTTON, INPUT_MOUSE_MOVE, INPUT_MOUSE_WHEEL};
use nesprotocol::{BIDI_CONTROL, BIDI_INPUT, Carrier, STREAM_CURSOR, STREAM_STATS};
use nesprotocol::{FRAME_HDR_LEN, STREAM_VERSION, encode_frame};
use nesprotocol::{
    MSG_CONTROL_MODE, MSG_ENCODE_SETTINGS, MSG_IDR_REQUEST, MSG_INPUT_BATCH, MSG_RECEIVER_REPORT,
};
use nesprotocol::{ReceiverReport, decode_control_mode, decode_receiver_report};

use crate::control::{Controller, PathView};

use crate::dgram::run_datagram_writer;

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};

/// One client, across the several connections it opens.
///
/// A connection is the unit congestion control, pacing and the datagram send
/// buffer all work on, so a client that put everything on one connection had
/// one queue for everything -- and video is the only flow big enough to build
/// a queue, so video delayed audio and input with it. Each kind of traffic
/// therefore gets its own connection, and this is what reassembles them into
/// one client. They are correlated by endpoint id, which is the same for every
/// connection a client opens.
///
/// Connections arrive in whatever order they are dialled, so every one is
/// optional until it turns up. Frames handed to a carrier that has not
/// connected yet are dropped, which is right: there is nothing to send them on.
pub struct ClientSession {
    /// The connection carrying the picture.
    ///
    /// The only one whose path is worth reading for control: it carries
    /// essentially all the bytes, so it is the only one that can build a
    /// backlog, and its congestion window is the one that describes where the
    /// video is going.
    video_conn: Option<Connection>,
    /// Kept only so it can be closed with the rest of the session.
    other_conns: Vec<Connection>,
    /// Set while this client has asked for a keyframe and not yet been sent
    /// one, so the writer knows its deltas are undecodable.
    awaiting_keyframe: Arc<AtomicBool>,
    /// Frames this client was not sent because it could not have decoded them.
    ///
    /// Read and cleared by the controller's tick: a second containing these is
    /// a second the hub starved on purpose, and reading it as path evidence
    /// would cut the bitrate in response to the hub's own decision.
    withheld: Arc<AtomicU64>,
    /// The most recent report from this client, if it has sent one.
    ///
    /// Overwritten rather than queued. A report describes the second that just
    /// passed, and an older one is not evidence about now.
    latest_report: Arc<std::sync::Mutex<Option<ReceiverReport>>>,
    relay_ms: Arc<AtomicU32>,
    input_broadcast: tokio::sync::broadcast::Sender<Vec<u8>>,
    idr_cmd_tx: tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
    controller: Arc<Mutex<Controller>>,
    send_video: tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
    send_audio: tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
    send_cursor: tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
    send_stats: tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
    /// Receiving ends, held until the carrier that drains them connects.
    pending_video: Option<tokio::sync::mpsc::UnboundedReceiver<Vec<u8>>>,
    pending_audio: Option<tokio::sync::mpsc::UnboundedReceiver<Vec<u8>>>,
    pending_cursor: Option<tokio::sync::mpsc::UnboundedReceiver<Vec<u8>>>,
    pending_stats: Option<tokio::sync::mpsc::UnboundedReceiver<Vec<u8>>>,
    tasks: Vec<tokio::task::JoinHandle<()>>,
}

impl ClientSession {
    /// A client with no connections yet. They attach as they are accepted.
    pub fn new(
        input_broadcast: tokio::sync::broadcast::Sender<Vec<u8>>,
        relay_ms: Arc<AtomicU32>,
        idr_cmd_tx: tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
        controller: Arc<Mutex<Controller>>,
    ) -> Self {
        let (video_tx, video_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
        let (audio_tx, audio_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
        let (cursor_tx, cursor_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
        let (stats_tx, stats_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
        Self {
            video_conn: None,
            other_conns: Vec::new(),
            awaiting_keyframe: Arc::new(AtomicBool::new(false)),
            withheld: Arc::new(AtomicU64::new(0)),
            latest_report: Arc::new(std::sync::Mutex::new(None)),
            relay_ms,
            input_broadcast,
            idr_cmd_tx,
            controller,
            send_video: video_tx,
            send_audio: audio_tx,
            send_cursor: cursor_tx,
            send_stats: stats_tx,
            pending_video: Some(video_rx),
            pending_audio: Some(audio_rx),
            pending_cursor: Some(cursor_rx),
            pending_stats: Some(stats_rx),
            tasks: Vec::new(),
        }
    }

    /// Whether the picture has somewhere to go.
    ///
    /// A client with every connection but this one is connected and not yet
    /// streaming, which for the controller is the same as not being there.
    pub fn is_streaming(&self) -> bool {
        self.video_conn.is_some()
    }

    /// Take on one of this client's connections.
    ///
    /// A carrier arriving twice is the second one being dropped: the first is
    /// already draining the channel, and two writers on one channel would split
    /// the stream between them.
    pub fn attach(&mut self, carrier: Carrier, conn: Connection) {
        match carrier {
            Carrier::Video => {
                let Some(rx) = self.pending_video.take() else {
                    debug!("video carrier attached twice; ignoring the second");
                    return;
                };
                self.video_conn = Some(conn.clone());
                let relay_ms = self.relay_ms.clone();
                let awaiting = self.awaiting_keyframe.clone();
                let withheld = self.withheld.clone();
                // Keyframes go on reliable streams of their own, because a lost
                // keyframe freezes the picture until the next one instead of
                // costing a single frame. See `nesprotocol::reliable`.
                self.tasks.push(tokio::spawn(async move {
                    run_datagram_writer(
                        conn,
                        DGRAM_VIDEO,
                        "video",
                        rx,
                        Some(relay_ms),
                        true,
                        Some(awaiting),
                        Some(withheld),
                    )
                    .await
                }));
            }
            Carrier::Audio => {
                let Some(rx) = self.pending_audio.take() else {
                    debug!("audio carrier attached twice; ignoring the second");
                    return;
                };
                self.other_conns.push(conn.clone());
                // No reliable path offered: audio has no keyframes to promote,
                // and on its own connection it is no longer queued behind any.
                self.tasks.push(tokio::spawn(async move {
                    run_datagram_writer(conn, DGRAM_AUDIO, "audio", rx, None, false, None, None)
                        .await
                }));
            }
            Carrier::Input => {
                self.other_conns.push(conn.clone());
                let broadcast = self.input_broadcast.clone();
                self.tasks
                    .push(tokio::spawn(
                        async move { run_input_reader(conn, broadcast).await },
                    ));
            }
            Carrier::Control => {
                let (Some(cursor_rx), Some(stats_rx)) =
                    (self.pending_cursor.take(), self.pending_stats.take())
                else {
                    debug!("control carrier attached twice; ignoring the second");
                    return;
                };
                self.other_conns.push(conn.clone());
                let conn_c = conn.clone();
                self.tasks
                    .push(tokio::spawn(
                        async move { run_cursor_sender(conn_c, cursor_rx).await },
                    ));
                let conn_s = conn.clone();
                self.tasks
                    .push(tokio::spawn(
                        async move { run_stats_sender(conn_s, stats_rx).await },
                    ));
                let reports = self.latest_report.clone();
                let awaiting = self.awaiting_keyframe.clone();
                let idr = self.idr_cmd_tx.clone();
                let controller = self.controller.clone();
                self.tasks.push(tokio::spawn(async move {
                    run_control_reader(conn, idr, reports, controller, awaiting).await
                }));
            }
        }
    }

    /// The latest report, cleared as it is taken.
    ///
    /// Taken rather than read so a client that stops reporting stops looking
    /// healthy: a report left in place would be read again every second and the
    /// controller would keep acting on a second that is long gone.
    /// Frames withheld since the last call, cleared as it is read.
    pub fn take_withheld(&self) -> u64 {
        self.withheld.swap(0, Ordering::Relaxed)
    }

    pub fn take_report(&self) -> Option<ReceiverReport> {
        self.latest_report.lock().ok()?.take()
    }

    /// What this end can see of the path, from the route actually in use.
    ///
    /// A connection can hold several paths at once -- typically one through a
    /// relay and one direct -- and only the selected one describes where the
    /// media is going.
    pub fn path_view(&self) -> PathView {
        // The video connection or nothing. Every connection now has its own
        // congestion window, and the one describing where the picture goes is
        // the only one worth controlling against -- audio's window says
        // nothing about whether the video is keeping up.
        let Some(conn) = self.video_conn.as_ref() else {
            return PathView::default();
        };
        let paths = conn.paths();
        let Some(path) = paths.iter().find(|p| p.is_selected()) else {
            return PathView::default();
        };
        let stats = path.stats();
        PathView {
            cwnd_bytes: Some(stats.cwnd),
            rtt_ms: Some(path.rtt().as_millis().min(u128::from(u32::MAX)) as u32),
            // What is left of the buffer says what is still in it. This is the
            // only signal either end has that reports an overrun *before* it
            // becomes loss, and it costs nothing to read.
            backlog_bytes: Some(
                (DGRAM_BUFFER_BYTES as u64)
                    .saturating_sub(conn.datagram_send_buffer_space() as u64),
            ),
        }
    }

    /// Hand one frame to this client's writer.
    ///
    /// A failure here is debug rather than warn because it is per frame: the
    /// only way it fails is a closed channel, which means the writer is already
    /// gone, and sixty warnings a second on the way down bury whatever actually
    /// ended the session.
    pub fn send_video_frame(&self, data: Vec<u8>) {
        if let Err(e) = self.send_video.send(data) {
            debug!("failed to send video data: {e}");
        }
    }

    pub fn send_audio_packet(&self, data: Vec<u8>) {
        if let Err(e) = self.send_audio.send(data) {
            debug!("failed to send audio data: {e}");
        }
    }

    pub fn send_cursor_data(&self, data: Vec<u8>) {
        if let Err(e) = self.send_cursor.send(data) {
            debug!("failed to send cursor data: {e}");
        }
    }

    pub fn send_stats_data(&self, data: Vec<u8>) {
        if let Err(e) = self.send_stats.send(data) {
            debug!("failed to send stats data: {e}");
        }
    }
}

#[allow(clippy::too_many_arguments)]
/// Open the client's bidi stream, announce what it is, and read framed
/// messages off it until it ends.
///
/// Shared because input and control differ only in which messages they expect:
/// the framing, the announcement and the reconnect behaviour are the same, and
/// two copies of that would drift.
async fn run_framed_reader<F, Fut>(
    conn: Connection,
    stream_type: u8,
    label: &'static str,
    mut handle: F,
) where
    F: FnMut(u8, Vec<u8>) -> Fut,
    Fut: std::future::Future<Output = ()>,
{
    debug!("{label} reader started");
    loop {
        match conn.open_bi().await {
            Ok((mut send, mut recv)) => {
                if send.write_all(&[stream_type, STREAM_VERSION]).await.is_err() {
                    debug!("{label} type byte write failed");
                    break;
                }
                let _ = send.finish();
                debug!("{label} bidi stream ready, reading framed messages");
                loop {
                    // [4B len][1B type][2B seq][payload]
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
                    handle(frame[0], frame[3..].to_vec()).await;
                }
            }
            Err(e) => {
                debug!("{label} open_bi failed: {e}");
                break;
            }
        }
    }
    debug!("{label} reader exiting");
}

/// Input events, and nothing else.
///
/// On its own connection so a keypress never waits behind a video keyframe.
async fn run_input_reader(
    conn: Connection,
    input_broadcast: tokio::sync::broadcast::Sender<Vec<u8>>,
) {
    run_framed_reader(conn, BIDI_INPUT, "input", |msg_type, payload| {
        let input_broadcast = input_broadcast.clone();
        async move {
            if msg_type != MSG_INPUT_BATCH {
                debug!("unknown input msg type: {msg_type}");
                return;
            }
            let mut offset = 0usize;
            while offset < payload.len() {
                match payload[offset] {
                    INPUT_KEY => {
                        if offset + 3 > payload.len() {
                            break;
                        }
                        let raw = vec![INPUT_KEY, payload[offset + 1], payload[offset + 2]];
                        let _ = input_broadcast.send(raw);
                        offset += 3;
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
                        let raw =
                            vec![INPUT_MOUSE_BUTTON, payload[offset + 1], payload[offset + 2]];
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
                    other => {
                        debug!("unknown input event type: {other}");
                        break;
                    }
                }
            }
        }
    })
    .await;
}

/// Everything the client says that is not an input event.
async fn run_control_reader(
    conn: Connection,
    idr_cmd_tx: tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
    latest_report: Arc<std::sync::Mutex<Option<ReceiverReport>>>,
    controller: Arc<Mutex<Controller>>,
    awaiting_keyframe: Arc<AtomicBool>,
) {
    run_framed_reader(conn, BIDI_CONTROL, "control", |msg_type, payload| {
        let idr_cmd_tx = idr_cmd_tx.clone();
        let latest_report = latest_report.clone();
        let controller = controller.clone();
        let awaiting_keyframe = awaiting_keyframe.clone();
        async move {
            match msg_type {
                MSG_IDR_REQUEST => {
                    // Client-side rate limited to one every two seconds, which
                    // is still far too often for info when a struggling
                    // receiver asks continuously.
                    debug!("received IDR request from client");
                    // Until one arrives, everything else sent to this client is
                    // undecodable and starves the keyframe that would fix it.
                    // See `dgram::ResyncGate`.
                    awaiting_keyframe.store(true, Ordering::Relaxed);
                    let _ = idr_cmd_tx.send(vec![MSG_IDR_REQUEST]);
                }
                MSG_ENCODE_SETTINGS => {
                    info!(
                        "received encode settings from client ({} bytes)",
                        payload.len()
                    );
                    // A person set this by hand, so the controller stops
                    // deciding until it is told otherwise. Overriding a
                    // person's setting a second later would take away the only
                    // tool that finds this class of bug.
                    if let Some((_, rc, value, _)) = nesprotocol::decode_encode_settings(&payload) {
                        let mut controller = controller.lock().await;
                        if rc == nesprotocol::RC_CBR {
                            controller.note_manual_target(value);
                        } else {
                            controller.set_constant_quality(true);
                        }
                    }
                    let mut cmd = Vec::with_capacity(1 + payload.len());
                    cmd.push(MSG_ENCODE_SETTINGS);
                    cmd.extend_from_slice(&payload);
                    let _ = idr_cmd_tx.send(cmd);
                }
                MSG_RECEIVER_REPORT => match decode_receiver_report(&payload) {
                    Some(report) => {
                        if let Ok(mut slot) = latest_report.lock() {
                            *slot = Some(report);
                        }
                    }
                    None => debug!("unreadable receiver report ({} bytes)", payload.len()),
                },
                MSG_CONTROL_MODE => match decode_control_mode(&payload) {
                    Some((mode, ceiling)) => {
                        let mut controller = controller.lock().await;
                        controller.set_mode(mode);
                        controller.set_constant_quality(false);
                        if let Some(kbps) = ceiling {
                            controller.set_ceiling(kbps);
                        }
                        info!("control mode {mode:?}, ceiling {ceiling:?}");
                    }
                    None => debug!("unreadable control mode ({} bytes)", payload.len()),
                },
                other => debug!("unknown control msg type: {other}"),
            }
        }
    })
    .await;
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

/// Whether a broadcast video payload is a keyframe.
///
/// The payload is `[1B codec][1B flags][4B ts][2B w][2B h][data]`, the same
/// layout `encode_ipc_frame` writes. Deliberately narrower than
/// `video_wants_reliable`, which also answers true for the reconfiguration
/// frame that follows a codec change: that one belongs on a reliable stream for
/// the same reason a keyframe does, but counting it as a keyframe would put a
/// once-per-session frame into a per-second rate.
fn is_keyframe(payload: &[u8]) -> bool {
    payload
        .get(nesprotocol::reliable::VIDEO_PAYLOAD_FLAGS_OFFSET)
        .is_some_and(|flags| flags & nesprotocol::FLAG_KEYFRAME != 0)
}

pub struct SessionManager {
    sessions: Arc<Mutex<HashMap<iroh::EndpointId, ClientSession>>>,
    /// Video bytes, split by what they were.
    ///
    /// One counter could not tell an encoder ignoring its bitrate target from a
    /// stream that is mostly keyframes, and those have opposite fixes. A session
    /// overshooting its target by ten times looked the same either way.
    video_key_bytes: AtomicU64,
    video_delta_bytes: AtomicU64,
    keyframes: AtomicU64,
    last_video_key_bytes: AtomicU64,
    last_video_delta_bytes: AtomicU64,
    last_keyframes: AtomicU64,
    /// How much this box's own pipeline delay varied, frame to frame.
    ///
    /// **Variation, not absolute delay**, and it cannot be otherwise: the
    /// encoder's `timestamp_ms` counts from its own start rather than from any
    /// epoch, so the difference to wall clock holds an unknown constant even
    /// though both run on this machine. Variation is also the comparable
    /// quantity -- the client measures the same thing about the total, using the
    /// same code, so the difference between the two is what the network added.
    pipeline: std::sync::Mutex<nesprotocol::delay::DelayTracker>,
    audio_bytes: AtomicU64,
    last_audio_bytes: AtomicU64,
    relay_ms: Arc<AtomicU32>, // latest relay latency (f32 bits)
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            video_key_bytes: AtomicU64::new(0),
            video_delta_bytes: AtomicU64::new(0),
            keyframes: AtomicU64::new(0),
            last_video_key_bytes: AtomicU64::new(0),
            last_video_delta_bytes: AtomicU64::new(0),
            last_keyframes: AtomicU64::new(0),
            pipeline: std::sync::Mutex::new(nesprotocol::delay::DelayTracker::new()),
            audio_bytes: AtomicU64::new(0),
            last_audio_bytes: AtomicU64::new(0),
            relay_ms: Arc::new(AtomicU32::new(0)),
        }
    }

    /// Take on one of a client's connections, creating the session if this is
    /// the first to arrive.
    ///
    /// A client dials several connections and they are accepted in whatever
    /// order they complete, so no one of them can be "the" arrival. They are
    /// matched by endpoint id, which every connection from one client shares.
    pub async fn attach(
        &self,
        id: iroh::EndpointId,
        carrier: Carrier,
        conn: Connection,
        input_broadcast: tokio::sync::broadcast::Sender<Vec<u8>>,
        idr_cmd_tx: tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
        controller: Arc<Mutex<Controller>>,
    ) {
        let mut sessions = self.sessions.lock().await;
        let fresh = !sessions.contains_key(&id);
        let session = sessions.entry(id).or_insert_with(|| {
            ClientSession::new(input_broadcast, self.relay_ms.clone(), idr_cmd_tx, controller)
        });
        session.attach(carrier, conn);
        if fresh {
            info!(remote = %id.fmt_short(), "client session added ({} total)", sessions.len());
        } else {
            debug!(remote = %id.fmt_short(), "{} carrier attached", carrier.label());
        }
    }

    pub async fn remove_session(&self, id: &iroh::EndpointId) {
        let mut sessions = self.sessions.lock().await;
        sessions.remove(id);
        info!(remote = %id.fmt_short(), "client session removed ({} remaining)", sessions.len());
    }

    /// Note how long this box took over a frame, relative to its own best.
    ///
    /// `ts_ms` is stamped at capture by an encoder on this same machine, so the
    /// clock is shared even though its origin is arbitrary -- which is exactly
    /// what [`DelayTracker`] is built for.
    ///
    /// [`DelayTracker`]: nesprotocol::delay::DelayTracker
    fn note_pipeline_delay(&self, payload: &[u8]) {
        let Some(ts_bytes) = payload.get(2..6) else {
            return;
        };
        let ts_ms = u32::from_le_bytes(ts_bytes.try_into().unwrap());
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or_default();
        if let Ok(mut pipeline) = self.pipeline.lock() {
            pipeline.observe(ts_ms, now_ms, std::time::Instant::now());
        }
    }

    /// The median, 95th percentile and worst pipeline variation since the last
    /// call, in milliseconds.
    ///
    /// Zeroes for a second in which no frame was broadcast. That is not the
    /// same as a second with no variation, but the wire has no room to say so
    /// and the client can tell from the frame counters beside it.
    pub fn pipeline_delays(&self) -> (u16, u16, u16) {
        let Ok(mut pipeline) = self.pipeline.lock() else {
            return (0, 0, 0);
        };
        pipeline
            .take()
            .map(|s| (s.p50_ms, s.p95_ms, s.max_ms))
            .unwrap_or((0, 0, 0))
    }

    pub async fn broadcast_video(&self, data: Vec<u8>) {
        self.note_pipeline_delay(&data);
        // Counted before the early return, like audio, so the figure measures
        // what the encoder produced rather than what a client happened to be
        // around for.
        if is_keyframe(&data) {
            self.video_key_bytes
                .fetch_add(data.len() as u64, Ordering::Relaxed);
            self.keyframes.fetch_add(1, Ordering::Relaxed);
        } else {
            self.video_delta_bytes
                .fetch_add(data.len() as u64, Ordering::Relaxed);
        }
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

    /// The report from whichever client is having the worst time, and the path
    /// view belonging to that same client.
    ///
    /// **The worst, not the average.** One encoder serves every client, so it
    /// can only answer one question, and the client that cannot decode is the
    /// one that matters -- averaging its trouble away leaves it never
    /// recovering while the numbers look acceptable.
    pub async fn worst_report(&self) -> (Option<ReceiverReport>, PathView, bool) {
        let sessions = self.sessions.lock().await;
        let mut worst: Option<(f32, ReceiverReport, PathView)> = None;
        let mut any_path = PathView::default();
        let mut self_inflicted = false;
        for session in sessions.values() {
            // Read for every client, not only the worst, and always cleared --
            // a count left behind would contaminate a later second too.
            self_inflicted |= session.take_withheld() > 0;
            let path = session.path_view();
            if path != PathView::default() {
                any_path = path;
            }
            // Taken every tick whether or not it is used, so a report never
            // outlives the second it describes.
            let Some(report) = session.take_report() else {
                continue;
            };
            // A report accounting for no frames says nothing about loss, so it
            // cannot be ranked -- but it is still the freshest thing this client
            // has said, and losing it would look like silence.
            let loss = report.loss().unwrap_or(0.0);
            if worst.as_ref().is_none_or(|(w, _, _)| loss > *w) {
                worst = Some((loss, report, path));
            }
        }
        match worst {
            Some((_, report, path)) => (Some(report), path, self_inflicted),
            None => (None, any_path, self_inflicted),
        }
    }

    pub fn relay_ms(&self) -> f32 {
        f32::from_bits(self.relay_ms.swap(0, Ordering::Relaxed))
    }

    /// Clients with somewhere to send a picture.
    ///
    /// Not simply the number of sessions: a client whose other connections
    /// have completed but whose video connection has not is connected and not
    /// yet streaming, and counting it would have the controller deciding a
    /// bitrate for a carrier that cannot yet take one.
    pub async fn client_count(&self) -> usize {
        self.sessions
            .lock()
            .await
            .values()
            .filter(|s| s.is_streaming())
            .count()
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

    /// Keyframe bits, delta bits and keyframe count for the last second.
    ///
    /// Like the audio figure, this assumes the caller ticks once a second: the
    /// difference since the previous call *is* the per-second number.
    pub fn video_breakdown(&self) -> (u32, u32, u8) {
        let per_second = |current: &AtomicU64, last: &AtomicU64| -> u64 {
            let now = current.load(Ordering::Relaxed);
            now.saturating_sub(last.swap(now, Ordering::Relaxed))
        };
        let key = per_second(&self.video_key_bytes, &self.last_video_key_bytes);
        let delta = per_second(&self.video_delta_bytes, &self.last_video_delta_bytes);
        let keyframes = per_second(&self.keyframes, &self.last_keyframes);
        (
            (key * 8) as u32,
            (delta * 8) as u32,
            keyframes.min(u64::from(u8::MAX)) as u8,
        )
    }
}

#[cfg(test)]
mod pipeline_delay_tests {
    use super::SessionManager;

    /// A video payload with `ts_ms` where the wire format puts it.
    fn payload(ts_ms: u32) -> Vec<u8> {
        let mut p = vec![0u8, 0u8];
        p.extend_from_slice(&ts_ms.to_le_bytes());
        p.extend_from_slice(&1920u16.to_le_bytes());
        p.extend_from_slice(&1080u16.to_le_bytes());
        p.extend_from_slice(&[0u8; 32]);
        p
    }

    #[test]
    fn a_second_with_no_frames_reports_nothing() {
        let mgr = SessionManager::new();
        assert_eq!(mgr.pipeline_delays(), (0, 0, 0));
    }

    #[test]
    fn a_steady_pipeline_reports_no_variation() {
        // The encoder's timestamp counts from its own start, so the difference
        // to wall clock holds a large unknown constant. A pipeline taking the
        // same time on every frame must read as zero, not as that constant --
        // which is what a plain subtraction would have reported, pinned at the
        // maximum the wire can carry.
        let mgr = SessionManager::new();
        for i in 0..60u32 {
            mgr.note_pipeline_delay(&payload(i * 16));
        }
        let (p50, _, max) = mgr.pipeline_delays();
        assert_eq!(p50, 0);
        assert!(
            max < 100,
            "a steady pipeline reported {max} ms of variation"
        );
    }

    #[test]
    fn draining_means_each_answer_describes_one_second() {
        let mgr = SessionManager::new();
        mgr.note_pipeline_delay(&payload(0));
        assert!(mgr.pipeline_delays().0 == 0);
        assert_eq!(mgr.pipeline_delays(), (0, 0, 0));
    }

    #[test]
    fn a_truncated_payload_is_ignored_rather_than_misread() {
        let mgr = SessionManager::new();
        mgr.note_pipeline_delay(&[0u8, 0u8, 1u8]);
        assert_eq!(mgr.pipeline_delays(), (0, 0, 0));
    }
}
