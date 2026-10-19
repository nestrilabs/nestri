use std::collections::HashMap;
use std::sync::Arc;

use iroh::endpoint::Connection;
use tokio::sync::Mutex;
use tracing::{debug, info, warn};

use nesprotocol::datagram::{DGRAM_AUDIO, DGRAM_BUFFER_BYTES, DGRAM_VIDEO};
use nesprotocol::input::{
    INPUT_KEY, INPUT_MOUSE_BUTTON, INPUT_MOUSE_MOVE, INPUT_MOUSE_WHEEL, INPUT_OUTPUT_SIZE,
};
use nesprotocol::{BIDI_CONTROL, BIDI_INPUT, Carrier, STREAM_CURSOR, STREAM_STATS};
use nesprotocol::{ControlMode, ReceiverReport, decode_control_mode, decode_receiver_report};
use nesprotocol::{FRAME_HDR_LEN, STREAM_VERSION, encode_frame};
use nesprotocol::{
    MSG_CLIENT_CAPS, MSG_CONTROL_MODE, MSG_ENCODE_SETTINGS, MSG_GAMEPAD, MSG_GAMEPAD_FEEDBACK,
    MSG_IDR_REQUEST, MSG_INPUT_BATCH, MSG_RECEIVER_REPORT, MSG_WINDOW_PAUSE, MSG_WINDOW_RESUME,
};

use crate::control::{Controller, PathView};
use crate::negotiation::{Negotiator, effective_caps};

use crate::capture_cmd::keyframe_request;
use crate::dgram::{MediaItem, run_datagram_writer};
use crate::windows::{Source, Subscription, WindowTable, route, wants_cursor};
use nesprotocol::window::{MSG_WINDOW_SUBSCRIBE, STREAM_WINDOWS, WINDOW_DEFAULT, WindowEvent, WindowId};
use bytes::Bytes;
use nesprotocol::pyrowave::PyroFrame;

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};

/// Input on its way to the box, ref(d-0085): which client sent it (its
/// gamepad session number), the window it belongs to, and the event. An empty
/// event asks only that the window be focused, which the box's side grants
/// only when no other client is typing; see `windows::FocusTagger`.
pub type TaggedInput = (u32, WindowId, Vec<u8>);

/// What a client's input reader needs to say which window its input is for.
#[derive(Clone)]
struct InputWindow {
    subscription: Arc<std::sync::Mutex<Subscription>>,
    /// The window of the box's primary picture, which is what a client that
    /// never subscribed is looking at.
    primary: Arc<AtomicU32>,
}

impl InputWindow {
    /// `None` while subscribed to a window that no longer exists.
    fn current(&self) -> Option<WindowId> {
        match *self.subscription.lock().ok()? {
            Subscription::Legacy => Some(self.primary.load(Ordering::Relaxed) as WindowId),
            Subscription::Window(w) => Some(w),
            Subscription::Torn => None,
        }
    }
}

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
    /// PyroWave frames this client was not sent because its queue was full.
    pyro_skipped: Arc<AtomicU64>,
    /// Whether this client said it decodes the PyroWave format this hub
    /// carries. Only then is a request for PyroWave passed on.
    pyrowave_ok: Arc<AtomicBool>,
    /// The rate a PyroWave request that names none runs at.
    pyrowave_kbps: u32,
    relay_ms: Arc<AtomicU32>,
    input_broadcast: tokio::sync::broadcast::Sender<TaggedInput>,
    /// Which window this client is shown, ref(d-0085).
    subscription: Arc<std::sync::Mutex<Subscription>>,
    /// The encoder whose frames this client was last sent (0: none yet), so
    /// its keyframe requests go to that encoder alone.
    encoder_pid: Arc<AtomicU32>,
    /// This session's pause of an encoder, if any (d-0087); released when it
    /// goes or looks at another picture.
    pause: crate::pauses::PauseHandle,
    primary_window: Arc<AtomicU32>,
    /// Where a subscribe request goes: the manager, which holds the windows.
    subscribe_tx: tokio::sync::mpsc::UnboundedSender<(iroh::EndpointId, WindowId)>,
    /// Lifecycle events for this client's windows stream, `[type][payload]`.
    send_windows: tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
    pending_windows: Option<tokio::sync::mpsc::UnboundedReceiver<Vec<u8>>>,
    /// This client's number on the gamepad socket, so the box's side can tell
    /// two clients' controllers apart. Assigned by the manager, never reused
    /// within one hub's lifetime.
    gamepad_session: u32,
    gamepad_tx: tokio::sync::broadcast::Sender<Vec<u8>>,
    /// Rumble and the like, for this client's input stream to carry back.
    send_gamepad_feedback: tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
    pending_gamepad_feedback: Option<tokio::sync::mpsc::UnboundedReceiver<Vec<u8>>>,
    idr_cmd_tx: tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
    controller: Arc<Mutex<Controller>>,
    /// Who this is, for the codec agreement.
    client: iroh::EndpointId,
    /// Where this client's capabilities go, so the codec is one every client
    /// can decode rather than whatever the newest one asked for.
    negotiator: Arc<Negotiator>,
    send_video: tokio::sync::mpsc::UnboundedSender<MediaItem>,
    send_audio: tokio::sync::mpsc::UnboundedSender<MediaItem>,
    send_cursor: tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
    send_stats: tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
    /// Receiving ends, held until the carrier that drains them connects.
    pending_video: Option<tokio::sync::mpsc::UnboundedReceiver<MediaItem>>,
    pending_audio: Option<tokio::sync::mpsc::UnboundedReceiver<MediaItem>>,
    pending_cursor: Option<tokio::sync::mpsc::UnboundedReceiver<Vec<u8>>>,
    pending_stats: Option<tokio::sync::mpsc::UnboundedReceiver<Vec<u8>>>,
    tasks: Vec<tokio::task::JoinHandle<()>>,
}

impl Drop for ClientSession {
    fn drop(&mut self) {
        // Dropping a `JoinHandle` detaches its task rather than stopping it,
        // so without this a removed session's readers and writers keep running
        // until their connections time out on their own -- seconds later, and
        // visible in the log as a session that had already gone still
        // reporting. They have nothing left to serve; the session holding
        // their channels is what is being dropped.
        for task in &self.tasks {
            task.abort();
        }
        // A pause is this client's, and does not outlive it.
        self.pause.close();
    }
}

impl ClientSession {
    /// A client with no connections yet. They attach as they are accepted.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        input_broadcast: tokio::sync::broadcast::Sender<TaggedInput>,
        primary_window: Arc<AtomicU32>,
        encoder_pid: u32,
        subscribe_tx: tokio::sync::mpsc::UnboundedSender<(iroh::EndpointId, WindowId)>,
        gamepad_session: u32,
        gamepad_tx: tokio::sync::broadcast::Sender<Vec<u8>>,
        relay_ms: Arc<AtomicU32>,
        idr_cmd_tx: tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
        controller: Arc<Mutex<Controller>>,
        pyrowave_kbps: u32,
        client: iroh::EndpointId,
        negotiator: Arc<Negotiator>,
        pauses: Arc<std::sync::Mutex<crate::pauses::PauseBook>>,
    ) -> Self {
        let (gamepad_feedback_tx, gamepad_feedback_rx) = tokio::sync::mpsc::unbounded_channel();
        let (video_tx, video_rx) = tokio::sync::mpsc::unbounded_channel::<MediaItem>();
        let (audio_tx, audio_rx) = tokio::sync::mpsc::unbounded_channel::<MediaItem>();
        let (cursor_tx, cursor_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
        let (stats_tx, stats_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
        let (windows_tx, windows_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
        let pause = crate::pauses::PauseHandle::new(pauses, gamepad_session, idr_cmd_tx.clone());
        Self {
            pause,
            subscription: Arc::new(std::sync::Mutex::new(Subscription::Legacy)),
            encoder_pid: Arc::new(AtomicU32::new(encoder_pid)),
            primary_window,
            subscribe_tx,
            send_windows: windows_tx,
            pending_windows: Some(windows_rx),
            video_conn: None,
            other_conns: Vec::new(),
            awaiting_keyframe: Arc::new(AtomicBool::new(false)),
            withheld: Arc::new(AtomicU64::new(0)),
            latest_report: Arc::new(std::sync::Mutex::new(None)),
            pyro_skipped: Arc::new(AtomicU64::new(0)),
            pyrowave_ok: Arc::new(AtomicBool::new(false)),
            pyrowave_kbps,
            relay_ms,
            input_broadcast,
            gamepad_session,
            gamepad_tx,
            send_gamepad_feedback: gamepad_feedback_tx,
            pending_gamepad_feedback: Some(gamepad_feedback_rx),
            idr_cmd_tx,
            controller,
            client,
            negotiator,
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
                // A writer that has just started has sent no reference frame,
                // so nothing but a keyframe can be decoded from it. Asked for
                // now rather than after the client fails to decode a delta and
                // says so, a round trip later; and deltas are held back until
                // it is sent, as for any client waiting on one.
                self.awaiting_keyframe.store(true, Ordering::Relaxed);
                let _ = self
                    .idr_cmd_tx
                    .send(keyframe_request(pid_or_all(&self.encoder_pid)));
                // The client says how each frame arrived, back on this same
                // connection; the rate is decided on each one as it comes.
                self.tasks.push(tokio::spawn(run_feedback_reader(
                    conn.clone(),
                    self.client,
                    self.controller.clone(),
                    self.idr_cmd_tx.clone(),
                )));
                // Lifecycle events, on a stream opened only once there is one
                // to send, which is only once this client has subscribed.
                if let Some(windows) = self.pending_windows.take() {
                    self.tasks
                        .push(tokio::spawn(run_windows_sender(conn.clone(), windows)));
                }
                let relay_ms = self.relay_ms.clone();
                let awaiting = self.awaiting_keyframe.clone();
                let withheld = self.withheld.clone();
                let pyro_skipped = self.pyro_skipped.clone();
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
                        Some(pyro_skipped),
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
                    run_datagram_writer(
                        conn,
                        DGRAM_AUDIO,
                        "audio",
                        rx,
                        None,
                        false,
                        None,
                        None,
                        None,
                    )
                    .await
                }));
            }
            Carrier::Input => {
                let Some(feedback) = self.pending_gamepad_feedback.take() else {
                    debug!("input carrier attached twice; ignoring the second");
                    return;
                };
                self.other_conns.push(conn.clone());
                let broadcast = self.input_broadcast.clone();
                let gamepad = Gamepads {
                    session: self.gamepad_session,
                    to_box: self.gamepad_tx.clone(),
                };
                let window = InputWindow {
                    subscription: self.subscription.clone(),
                    primary: self.primary_window.clone(),
                };
                self.tasks.push(tokio::spawn(async move {
                    run_input_reader(conn, broadcast, window, gamepad, feedback).await
                }));
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
                self.tasks.push(tokio::spawn(async move {
                    run_cursor_sender(conn_c, cursor_rx).await
                }));
                let conn_s = conn.clone();
                self.tasks.push(tokio::spawn(async move {
                    run_stats_sender(conn_s, stats_rx).await
                }));
                let reports = self.latest_report.clone();
                let awaiting = self.awaiting_keyframe.clone();
                let idr = self.idr_cmd_tx.clone();
                let controller = self.controller.clone();
                let pyrowave = PyroWaveGate {
                    ok: self.pyrowave_ok.clone(),
                    default_kbps: self.pyrowave_kbps,
                };
                let caps = CapsSink {
                    client: self.client,
                    negotiator: self.negotiator.clone(),
                };
                let pause = self.pause.clone();
                let subscribe = (
                    self.client,
                    self.subscribe_tx.clone(),
                    self.encoder_pid.clone(),
                );
                self.tasks.push(tokio::spawn(async move {
                    run_control_reader(
                        conn, idr, reports, controller, awaiting, pyrowave, caps, subscribe, pause,
                    )
                    .await
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

    /// PyroWave frames skipped since the last call, cleared as it is read.
    pub fn take_pyro_skipped(&self) -> u64 {
        self.pyro_skipped.swap(0, Ordering::Relaxed)
    }

    /// The largest PyroWave packet one of this client's datagrams carries now.
    pub fn pyro_packet_limit(&self) -> Option<usize> {
        let max = self.video_conn.as_ref()?.max_datagram_size()?;
        Some(max.saturating_sub(nesprotocol::pyrowave::PYRO_DGRAM_HDR_LEN))
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
    ///
    /// **Nothing is queued for a carrier that has not attached.** A client's
    /// connections arrive one after another and its session exists from the
    /// first, so a channel created with the session would collect every frame
    /// produced before its own connection is up and deliver the lot the moment
    /// it is: measured 2026-10-16 as 160 ms of audio landing at once as a
    /// session began, and over half a second of video. Media is live or it is
    /// nothing, so until the writer exists there is nobody to give it to.
    pub fn send_video_frame(&self, item: MediaItem) {
        if self.pending_video.is_some() {
            return;
        }
        if let Err(e) = self.send_video.send(item) {
            debug!("failed to send video data: {e}");
        }
    }

    /// Hand one audio packet to this client's writer, once it has one. See
    /// [`send_video_frame`](Self::send_video_frame).
    pub fn send_audio_packet(&self, data: Bytes) {
        if self.pending_audio.is_some() {
            return;
        }
        if let Err(e) = self.send_audio.send(MediaItem::Coded(data)) {
            debug!("failed to send audio data: {e}");
        }
    }

    pub fn send_cursor_data(&self, data: Vec<u8>) {
        if let Err(e) = self.send_cursor.send(data) {
            debug!("failed to send cursor data: {e}");
        }
    }

    /// Hand one gamepad feedback message to this client's input stream.
    pub fn send_gamepad_feedback(&self, message: Vec<u8>) {
        if let Err(e) = self.send_gamepad_feedback.send(message) {
            debug!("failed to send gamepad feedback: {e}");
        }
    }

    pub fn send_stats_data(&self, data: Vec<u8>) {
        if let Err(e) = self.send_stats.send(data) {
            debug!("failed to send stats data: {e}");
        }
    }

    /// Which window this client is shown.
    pub fn subscription(&self) -> Subscription {
        self.subscription
            .lock()
            .map(|s| *s)
            .unwrap_or(Subscription::Legacy)
    }

    /// Show this client another window, and return what it was shown before.
    ///
    /// In the order the protocol asks for: the switch first, so the next frame
    /// routed to this client is the new window's, then the writer's numbering
    /// and resynchronisation reset in line with the frames, then a keyframe
    /// requested, since nothing the client holds predicts the new window. A
    /// keyframe requested before the switch could arrive for the old one.
    pub fn subscribe(
        &self,
        to: Subscription,
        encoder: Option<u32>,
        idr_cmd_tx: &tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
    ) -> Subscription {
        let before = match self.subscription.lock() {
            Ok(mut s) => std::mem::replace(&mut *s, to),
            Err(_) => return Subscription::Legacy,
        };
        if before == to {
            return before;
        }
        self.restart_picture();
        self.encoder_pid.store(encoder.unwrap_or(0), Ordering::Relaxed);
        if matches!(to, Subscription::Window(_)) {
            let _ = idr_cmd_tx.send(keyframe_request(encoder));
        }
        before
    }

    /// What this client is shown is now another encoder's picture: number from
    /// zero, hold deltas until a keyframe, and forget what it reported about
    /// the old one. The caller asks for the keyframe.
    pub fn restart_picture(&self) {
        // Another picture: whatever this client paused is no longer the one
        // it is shown, so it stops holding it.
        self.pause.release();
        self.awaiting_keyframe.store(true, Ordering::Relaxed);
        if self.pending_video.is_none() {
            let _ = self.send_video.send(MediaItem::Resubscribe);
        }
        let _ = self.take_report();
    }

    /// Queue one lifecycle message, `[type][payload]`, for the windows stream.
    pub fn send_window_message(&self, message: Vec<u8>) {
        if let Err(e) = self.send_windows.send(message) {
            debug!("failed to queue a window event: {e}");
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
///
/// With `outbound`, the stream's other half stays open and carries those
/// frames back to the client; without, it is finished once announced.
async fn run_framed_reader<F, Fut>(
    conn: Connection,
    stream_type: u8,
    label: &'static str,
    mut outbound: Option<(u8, tokio::sync::mpsc::UnboundedReceiver<Vec<u8>>)>,
    mut handle: F,
) where
    F: FnMut(u8, Vec<u8>) -> Fut,
    Fut: std::future::Future<Output = ()>,
{
    debug!("{label} reader started");
    loop {
        match conn.open_bi().await {
            Ok((mut send, mut recv)) => {
                if send
                    .write_all(&[stream_type, STREAM_VERSION])
                    .await
                    .is_err()
                {
                    debug!("{label} type byte write failed");
                    break;
                }
                if outbound.is_none() {
                    let _ = send.finish();
                }
                debug!("{label} bidi stream ready, reading framed messages");
                // Frames are read on a task of their own. Reading one is
                // several awaits, and a read cancelled halfway -- which is what
                // waiting on outbound frames beside it would do -- loses the
                // framing for the rest of the stream.
                let (frames_tx, mut frames) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();
                let reader = tokio::spawn(async move {
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
                        if frames_tx.send(frame).is_err() {
                            break;
                        }
                    }
                });
                let mut seq: u16 = 0;
                loop {
                    let outgoing = async {
                        match outbound.as_mut() {
                            Some((_, rx)) => rx.recv().await,
                            None => std::future::pending().await,
                        }
                    };
                    tokio::select! {
                        frame = frames.recv() => match frame {
                            Some(frame) => handle(frame[0], frame[3..].to_vec()).await,
                            None => break,
                        },
                        Some(payload) = outgoing => {
                            let msg_type = outbound.as_ref().map_or(0, |(t, _)| *t);
                            let mut buf = Vec::with_capacity(FRAME_HDR_LEN + payload.len());
                            encode_frame(&mut buf, msg_type, seq, &payload);
                            seq = seq.wrapping_add(1);
                            if send.write_all(&buf).await.is_err() {
                                break;
                            }
                        }
                    }
                }
                reader.abort();
            }
            Err(e) => {
                debug!("{label} open_bi failed: {e}");
                break;
            }
        }
    }
    debug!("{label} reader exiting");
}

/// Split a batch of input events into the individual events to broadcast.
///
/// Its own function because it is the only part of the input path with
/// arithmetic in it, and arithmetic is the part that can be wrong while
/// everything still runs. A key event is four bytes and was read as three:
/// the keycode lost its high byte, the offset finished one short, and every
/// later event in the batch was read starting one byte inside the one before
/// it. Nothing failed -- events were forwarded, the stream stayed up, and the
/// only sign was a keycode appearing in the log as an event type.
///
/// Stops at the first malformed event rather than trying to resynchronise. A
/// batch is built by one sender in one write; if it does not parse, the
/// disagreement is about the format and skipping ahead would only invent
/// events nobody sent.
fn split_input_events(payload: &[u8]) -> Vec<Vec<u8>> {
    let mut out = Vec::new();
    let mut offset = 0usize;
    while offset < payload.len() {
        // Type, then the event's own fields. The widths are the protocol's,
        // not this function's: see `nesprotocol::input`.
        let len = match payload[offset] {
            // [type][up/down][keycode u16 LE]
            INPUT_KEY => 4,
            // [type][dx i16 LE][dy i16 LE], and [type][w u16 LE][h u16 LE]
            INPUT_MOUSE_MOVE | INPUT_MOUSE_WHEEL | INPUT_OUTPUT_SIZE => 5,
            // [type][button][up/down]
            INPUT_MOUSE_BUTTON => 3,
            other => {
                debug!("unknown input event type: {other}");
                break;
            }
        };
        if offset + len > payload.len() {
            break;
        }
        out.push(payload[offset..offset + len].to_vec());
        offset += len;
    }
    out
}

/// How often a client's gamepad may ask for its window's focus. Only a bound
/// on the asking: a request for the window that already has focus changes
/// nothing.
const GAMEPAD_FOCUS_ASK: std::time::Duration = std::time::Duration::from_millis(100);

/// The encoder a client's keyframe requests are for, or every encoder when
/// it has not been sent anyone's frames yet.
fn pid_or_all(pid: &AtomicU32) -> Option<u32> {
    match pid.load(Ordering::Relaxed) {
        0 => None,
        pid => Some(pid),
    }
}

/// Where one client's gamepad messages go.
struct Gamepads {
    session: u32,
    to_box: tokio::sync::broadcast::Sender<Vec<u8>>,
}

/// Input events and gamepad messages, and nothing else.
///
/// On its own connection so a keypress never waits behind a video keyframe.
/// Gamepad messages are forwarded unread, tagged with the client: what a
/// controller is and what to make of it is the box's side to decide, not the
/// hub's. The stream's return half carries that side's feedback -- rumble --
/// back.
///
/// Each event goes to the box with the window this client is shown, which is
/// where the box's focus tags come from, ref(d-0085). A gamepad message also
/// asks for that window's focus: the pads reach the game by another route,
/// and a game reads them only while it has focus. Asked at most every
/// [`GAMEPAD_FOCUS_ASK`]; whether it is granted is the tagger's decision.
async fn run_input_reader(
    conn: Connection,
    input_broadcast: tokio::sync::broadcast::Sender<TaggedInput>,
    window: InputWindow,
    gamepads: Gamepads,
    feedback: tokio::sync::mpsc::UnboundedReceiver<Vec<u8>>,
) {
    let outbound = Some((MSG_GAMEPAD_FEEDBACK, feedback));
    let mut focus_asked: Option<std::time::Instant> = None;
    run_framed_reader(conn, BIDI_INPUT, "input", outbound, |msg_type, payload| {
        let input_broadcast = input_broadcast.clone();
        let to_box = gamepads.to_box.clone();
        let session = gamepads.session;
        let target = window.current();
        let mut ask_focus = None;
        if msg_type == MSG_GAMEPAD
            && let Some(w) = target
        {
            let now = std::time::Instant::now();
            if focus_asked.is_none_or(|at| now.duration_since(at) >= GAMEPAD_FOCUS_ASK) {
                focus_asked = Some(now);
                ask_focus = Some(w);
            }
        }
        async move {
            match msg_type {
                MSG_INPUT_BATCH => {
                    // Nothing to deliver to: the window this client was shown
                    // went with its compositor.
                    let Some(w) = target else { return };
                    for event in split_input_events(&payload) {
                        let _ = input_broadcast.send((session, w, event));
                    }
                }
                MSG_GAMEPAD => {
                    if let Some(w) = ask_focus {
                        let _ = input_broadcast.send((session, w, Vec::new()));
                    }
                    let mut frame = Vec::with_capacity(6 + payload.len());
                    nesprotocol::gamepad::encode_ipc(&mut frame, session, &payload);
                    // An error is nobody listening: the box's gamepad side is
                    // not up, and a controller it never heard of will be asked
                    // for again once it is.
                    let _ = to_box.send(frame);
                }
                other => debug!("unknown input msg type: {other}"),
            }
        }
    })
    .await;
}

/// What the control reader needs to decide about a PyroWave request.
#[derive(Clone)]
struct PyroWaveGate {
    /// Set once the client's capabilities named PyroWave in this hub's format.
    ok: Arc<AtomicBool>,
    default_kbps: u32,
}

/// Turn a client's PyroWave request into the command nescapture gets, or say
/// why it cannot have one.
///
/// A rate of zero means "the hub's default". The packet size is left for the
/// command forwarder, which fills it in as it sends: only the hub sees the
/// path, and what fits a datagram is a fact about the moment the encoder is
/// told, not the moment the client asked.
fn pyrowave_request(
    request: nesprotocol::EncodeSettings,
    gate: &PyroWaveGate,
) -> Result<nesprotocol::EncodeSettings, &'static str> {
    if !gate.ok.load(Ordering::Relaxed) {
        return Err("the client never said it decodes this hub's PyroWave format");
    }
    if request.rate_control != nesprotocol::RC_CBR {
        return Err("PyroWave runs at a set rate, and the request named none");
    }
    Ok(nesprotocol::EncodeSettings {
        value: if request.value == 0 {
            gate.default_kbps
        } else {
            request.value
        },
        bit_depth: Some(request.bit_depth.unwrap_or(nesprotocol::DEPTH_8)),
        chroma: Some(request.chroma.unwrap_or(nesprotocol::pyrowave::CHROMA_420)),
        packet_size: None,
        ..request
    })
}

/// Where a client's statement of what it decodes is recorded.
#[derive(Clone)]
struct CapsSink {
    client: iroh::EndpointId,
    negotiator: Arc<Negotiator>,
}

/// Everything the client says that is not an input event.
#[allow(clippy::too_many_arguments)]
async fn run_control_reader(
    conn: Connection,
    idr_cmd_tx: tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
    latest_report: Arc<std::sync::Mutex<Option<ReceiverReport>>>,
    controller: Arc<Mutex<Controller>>,
    awaiting_keyframe: Arc<AtomicBool>,
    pyrowave: PyroWaveGate,
    caps_sink: CapsSink,
    // Who this is, where subscribe requests go, and the encoder this
    // client's keyframe requests are for.
    subscribe: (
        iroh::EndpointId,
        tokio::sync::mpsc::UnboundedSender<(iroh::EndpointId, WindowId)>,
        Arc<AtomicU32>,
    ),
    pause: crate::pauses::PauseHandle,
) {
    run_framed_reader(conn, BIDI_CONTROL, "control", None, |msg_type, payload| {
        let idr_cmd_tx = idr_cmd_tx.clone();
        let latest_report = latest_report.clone();
        let controller = controller.clone();
        let awaiting_keyframe = awaiting_keyframe.clone();
        let pyrowave = pyrowave.clone();
        let caps_sink = caps_sink.clone();
        let subscribe = subscribe.clone();
        let pause = pause.clone();
        async move {
            match msg_type {
                MSG_WINDOW_SUBSCRIBE => match nesprotocol::window::decode_subscribe(&payload) {
                    Some(window) => {
                        info!("client subscribes to window {window}");
                        let _ = subscribe.1.send((subscribe.0, window));
                    }
                    None => debug!("unreadable window subscribe ({} bytes)", payload.len()),
                },
                MSG_IDR_REQUEST => {
                    // Client-side rate limited to one every two seconds, which
                    // is still far too often for info when a struggling
                    // receiver asks continuously.
                    debug!("received IDR request from client");
                    // Until one arrives, everything else sent to this client is
                    // undecodable and starves the keyframe that would fix it.
                    // See `dgram::ResyncGate`.
                    awaiting_keyframe.store(true, Ordering::Relaxed);
                    // To the encoder of the window this client is shown,
                    // ref(d-0085): the other windows are fine.
                    let _ = idr_cmd_tx.send(keyframe_request(pid_or_all(&subscribe.2)));
                }
                MSG_WINDOW_PAUSE => {
                    // This session's pause of the encoder it is shown, and of
                    // nothing else. Until it has been sent a frame the hub
                    // does not know that encoder, and there is nothing to pause.
                    match pid_or_all(&subscribe.2) {
                        Some(pid) => {
                            info!(client = %subscribe.0.fmt_short(), "pause: client pauses encoder {pid}");
                            pause.pause(pid);
                        }
                        None => info!(
                            client = %subscribe.0.fmt_short(),
                            "pause: no encoder known for this client yet; ignored"
                        ),
                    }
                }
                MSG_WINDOW_RESUME => {
                    // Only what this session paused. A resume from one that
                    // paused nothing starts nothing; the keyframe is asked for
                    // either way, since the client restarted its picture.
                    awaiting_keyframe.store(true, Ordering::Relaxed);
                    info!(
                        client = %subscribe.0.fmt_short(),
                        "resume: encoder {:?}",
                        pid_or_all(&subscribe.2)
                    );
                    pause.resume();
                    if let Some(pid) = pid_or_all(&subscribe.2) {
                        let _ = idr_cmd_tx.send(keyframe_request(Some(pid)));
                    }
                }
                MSG_CLIENT_CAPS => {
                    // Passed through untouched, and in particular *without*
                    // taking the controller off automatic the way encode
                    // settings do. This is the client stating a fact about
                    // itself, not a person overriding a decision, and reading
                    // it as the latter would silently stop the bitrate
                    // controller the first time a client said what it can
                    // decode.
                    match nesprotocol::decode_client_caps(&payload) {
                        Some(caps) => {
                            // Recorded whatever the mode: it is a fact about the
                            // client, consulted only if it asks for PyroWave.
                            let format = nesprotocol::decode_pyrowave_format(&payload);
                            let pyro = caps.supports_codec(nesprotocol::CODEC_PYROWAVE);
                            pyrowave.ok.store(
                                pyro && format == Some(nesprotocol::pyrowave::PYROWAVE_FORMAT),
                                Ordering::Relaxed,
                            );
                            if pyro && format != Some(nesprotocol::pyrowave::PYROWAVE_FORMAT) {
                                info!(
                                    "client decodes PyroWave format {format:?}, this hub carries \
                                     {}; it will not be sent PyroWave",
                                    nesprotocol::pyrowave::PYROWAVE_FORMAT
                                );
                            }
                            // Not forwarded as it stands: the encoder serves
                            // every client, so it is given what all of them
                            // decode. See `negotiation`.
                            info!("client decodes {:#010b}", caps.bits());
                            caps_sink
                                .negotiator
                                .state(caps_sink.client, effective_caps(caps, format));
                            caps_sink.negotiator.settle(&controller, &idr_cmd_tx).await;
                        }
                        None => debug!("unreadable client capabilities ({} bytes)", payload.len()),
                    }
                }
                MSG_ENCODE_SETTINGS => {
                    info!(
                        "received encode settings from client ({} bytes)",
                        payload.len()
                    );
                    let mut payload = payload;
                    if let Some(request) = nesprotocol::decode_encode_settings_ext(&payload)
                        && request.codec == nesprotocol::CODEC_PYROWAVE
                    {
                        match pyrowave_request(request, &pyrowave) {
                            Ok(settings) => {
                                info!("client asked for PyroWave at {} kbps", settings.value);
                                payload.clear();
                                nesprotocol::encode_settings(&mut payload, &settings);
                            }
                            Err(why) => {
                                warn!("refusing a PyroWave request: {why}");
                                return;
                            }
                        }
                    }
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
                        {
                            let mut controller = controller.lock().await;
                            controller.set_mode(mode);
                            controller.set_constant_quality(false);
                            if let Some(kbps) = ceiling {
                                controller.set_ceiling(kbps);
                            }
                        }
                        info!("control mode {mode:?}, ceiling {ceiling:?}");
                        // Whoever joined or left while a person was choosing
                        // was not acted on then; now it is.
                        if mode == ControlMode::Auto {
                            caps_sink.negotiator.settle(&controller, &idr_cmd_tx).await;
                        }
                    }
                    None => debug!("unreadable control mode ({} bytes)", payload.len()),
                },
                other => debug!("unknown control msg type: {other}"),
            }
        }
    })
    .await;
}

/// The windows stream, ref(d-0085): `[STREAM_WINDOWS][STREAM_VERSION]` then
/// one frame per lifecycle event. Opened on the first event, so a client that
/// never subscribes never sees it.
async fn run_windows_sender(
    conn: Connection,
    mut rx: tokio::sync::mpsc::UnboundedReceiver<Vec<u8>>,
) {
    let Some(first) = rx.recv().await else {
        return;
    };
    let mut send = match conn.open_uni().await {
        Ok(s) => s,
        Err(e) => {
            debug!("windows open_uni failed: {e}");
            return;
        }
    };
    if send
        .write_all(&[STREAM_WINDOWS, STREAM_VERSION])
        .await
        .is_err()
    {
        return;
    }
    let mut buf = Vec::new();
    let mut next = Some(first);
    while let Some(message) = next {
        if let Some((&msg_type, payload)) = message.split_first() {
            buf.clear();
            encode_frame(&mut buf, msg_type, 0, payload);
            if send.write_all(&buf).await.is_err() {
                return;
            }
        }
        next = rx.recv().await;
    }
    let _ = send.finish();
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

/// Read a client's per-frame feedback and decide the rate on each frame.
///
/// Acted on here, as it arrives, rather than collected for a once-a-second
/// tick: a queue that starts building is answered a frame interval later, not
/// up to a second later, which at 60 frames a second is the difference
/// between one frame's queue and sixty.
async fn run_feedback_reader(
    conn: Connection,
    client: iroh::EndpointId,
    controller: Arc<Mutex<Controller>>,
    cmd_tx: tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
) {
    loop {
        let datagram = match conn.read_datagram().await {
            Ok(d) => d,
            Err(e) => {
                debug!("feedback reader ended: {e}");
                return;
            }
        };
        let Some(frame) = nesprotocol::datagram::decode_feedback(&datagram) else {
            continue;
        };
        let now_us = nesprotocol::clock::monotonic_us();
        let mut controller = controller.lock().await;
        if let Some(kbps) = controller.on_feedback(client, &frame, now_us) {
            crate::control::actuate(&cmd_tx, &controller, kbps);
        }
    }
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
    /// Every client's gamepad messages, already framed for the gamepad socket.
    gamepad_tx: tokio::sync::broadcast::Sender<Vec<u8>>,
    next_gamepad_session: AtomicU32,
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
    /// Variation above the pipeline's own best, measured with the same code the
    /// client measures the whole path with, so the two are comparable and the
    /// difference between them is what the network added. The encoder stamps
    /// capture on the clock this hub reads at hand-off, so there is no offset
    /// to remove here and no skew either.
    pipeline: std::sync::Mutex<nesprotocol::delay::DelayTracker>,
    audio_bytes: AtomicU64,
    last_audio_bytes: AtomicU64,
    relay_ms: Arc<AtomicU32>, // latest relay latency (f32 bits)
    /// The rate a PyroWave request that names none runs at.
    pyrowave_kbps: u32,
    /// What every connected client decodes, and so what the encoder may pick.
    negotiator: Arc<Negotiator>,
    /// The box's windows and which encoder draws which, ref(d-0085).
    windows: std::sync::Mutex<WindowTable>,
    /// The window of the primary picture, for input from clients that never
    /// subscribed.
    primary_window: Arc<AtomicU32>,
    /// The window the cursor updates describe, as nescope last said.
    cursor_window: AtomicU32,
    subscribe_tx: tokio::sync::mpsc::UnboundedSender<(iroh::EndpointId, WindowId)>,
    subscribe_rx:
        std::sync::Mutex<Option<tokio::sync::mpsc::UnboundedReceiver<(iroh::EndpointId, WindowId)>>>,
    /// The encoder of the primary picture (0: untagged or none yet).
    primary_pid: Arc<AtomicU32>,
    /// Which sessions have paused which encoders, ref(d-0087).
    pauses: Arc<std::sync::Mutex<crate::pauses::PauseBook>>,
    /// Where commands for the encoders go; set by `serve_subscriptions`.
    cmd_tx: std::sync::OnceLock<tokio::sync::mpsc::UnboundedSender<Vec<u8>>>,
}

impl SessionManager {
    pub fn new(pyrowave_kbps: u32) -> Self {
        let (gamepad_tx, _) = tokio::sync::broadcast::channel(256);
        let (subscribe_tx, subscribe_rx) = tokio::sync::mpsc::unbounded_channel();
        Self {
            windows: std::sync::Mutex::new(WindowTable::default()),
            primary_window: Arc::new(AtomicU32::new(0)),
            cursor_window: AtomicU32::new(0),
            subscribe_tx,
            subscribe_rx: std::sync::Mutex::new(Some(subscribe_rx)),
            primary_pid: Arc::new(AtomicU32::new(0)),
            cmd_tx: std::sync::OnceLock::new(),
            sessions: Arc::new(Mutex::new(HashMap::new())),
            gamepad_tx,
            next_gamepad_session: AtomicU32::new(1),
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
            pyrowave_kbps,
            negotiator: Arc::new(Negotiator::new()),
            pauses: Default::default(),
        }
    }

    /// A session's pause handle, for tests.
    #[cfg(test)]
    pub(crate) async fn pause_handle_of(
        &self,
        id: &iroh::EndpointId,
    ) -> Option<crate::pauses::PauseHandle> {
        self.sessions.lock().await.get(id).map(|s| s.pause.clone())
    }

    #[cfg(test)]
    pub(crate) async fn encoder_pid_of(&self, id: &iroh::EndpointId) -> Option<u32> {
        self.sessions
            .lock()
            .await
            .get(id)
            .map(|s| s.encoder_pid.load(Ordering::Relaxed))
    }

    #[cfg(test)]
    pub(crate) fn encoder_paused(&self, pid: u32) -> bool {
        self.pauses.lock().unwrap().paused(pid)
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
        input_broadcast: tokio::sync::broadcast::Sender<TaggedInput>,
        idr_cmd_tx: tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
        controller: Arc<Mutex<Controller>>,
    ) {
        let mut sessions = self.sessions.lock().await;
        let fresh = !sessions.contains_key(&id);
        let session = sessions.entry(id).or_insert_with(|| {
            ClientSession::new(
                input_broadcast,
                self.primary_window.clone(),
                self.primary_pid.load(Ordering::Relaxed),
                self.subscribe_tx.clone(),
                self.next_gamepad_session.fetch_add(1, Ordering::Relaxed),
                self.gamepad_tx.clone(),
                self.relay_ms.clone(),
                idr_cmd_tx,
                controller,
                self.pyrowave_kbps,
                id,
                self.negotiator.clone(),
                self.pauses.clone(),
            )
        });
        session.attach(carrier, conn);
        if fresh {
            info!(remote = %id.fmt_short(), "client session added ({} total)", sessions.len());
        } else {
            debug!(remote = %id.fmt_short(), "{} carrier attached", carrier.label());
        }
    }

    /// A video frame arrived in `codec`; see [`Negotiator::reassert`].
    pub async fn reassert_codec(
        &self,
        codec: u8,
        controller: &Mutex<Controller>,
        cmd_tx: &tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
    ) {
        self.negotiator.reassert(codec, controller, cmd_tx).await;
    }

    /// Drop a client, and let the encoder move to whatever the clients still
    /// here can all decode -- a better codec, when the one that left was the
    /// one holding the rest back.
    pub async fn remove_session(
        &self,
        id: &iroh::EndpointId,
        controller: &Mutex<Controller>,
        cmd_tx: &tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
    ) {
        if self.drop_session(id).await {
            self.negotiator.forget(id);
            self.negotiator.settle(controller, cmd_tx).await;
        }
    }

    /// Whether there was a session to drop.
    async fn drop_session(&self, id: &iroh::EndpointId) -> bool {
        let mut sessions = self.sessions.lock().await;
        // Said only when something was actually removed. Every carrier of a
        // client reports its own close, so a client leaving announced its
        // session as removed four times over -- three of them describing a
        // session that had already gone, which reads like four clients
        // leaving.
        if let Some(session) = sessions.remove(id) {
            info!(remote = %id.fmt_short(), "client session removed ({} remaining)", sessions.len());
            // Its controllers go with it. The client cannot say so itself --
            // it is the thing that went -- and a controller left plugged in
            // would still be there for the game, held by nobody.
            let mut message = Vec::with_capacity(1);
            nesprotocol::gamepad::PadMessage::SessionEnd.encode(&mut message);
            let mut frame = Vec::with_capacity(7);
            nesprotocol::gamepad::encode_ipc(&mut frame, session.gamepad_session, &message);
            let _ = self.gamepad_tx.send(frame);
            return true;
        }
        false
    }

    /// A receiver for every client's gamepad messages, for the gamepad socket.
    pub fn gamepad_messages(&self) -> tokio::sync::broadcast::Receiver<Vec<u8>> {
        self.gamepad_tx.subscribe()
    }

    /// Route gamepad feedback to the client it names.
    ///
    /// A client that has gone is not an error: rumble a game started a moment
    /// before its player left has nowhere to go, and that is fine.
    pub async fn send_gamepad_feedback(&self, gamepad_session: u32, message: Vec<u8>) {
        let sessions = self.sessions.lock().await;
        if let Some(session) = sessions
            .values()
            .find(|s| s.gamepad_session == gamepad_session)
        {
            session.send_gamepad_feedback(message);
        }
    }

    /// Note how long this box took over a frame, relative to its own best.
    ///
    /// The frame's capture time is stamped by an encoder on this same machine,
    /// on the clock read here at hand-off (`nesprotocol::clock`).
    ///
    /// [`DelayTracker`]: nesprotocol::delay::DelayTracker
    fn note_pipeline_delay(&self, payload: &[u8]) {
        if let Some((head, _)) = nesprotocol::decode_video_payload(payload) {
            self.note_pipeline_ts(head.captured_us);
        }
    }

    fn note_pipeline_ts(&self, captured_us: u64) {
        if let Ok(mut pipeline) = self.pipeline.lock() {
            pipeline.observe(captured_us, nesprotocol::clock::monotonic_us());
        }
    }

    /// The median, 95th percentile and worst pipeline variation since the last
    /// call, in milliseconds.
    ///
    /// Zeroes for a second in which no frame was broadcast. That is not the
    /// same as a second with no variation, but the wire has no room to say so
    /// and the client can tell from the frame counters beside it.
    pub fn pipeline_delays(&self) -> (u16, u16, u16) {
        // The stats stream carries whole milliseconds; the measurement is finer.
        fn ms(us: u32) -> u16 {
            (us / 1000).min(u32::from(u16::MAX)) as u16
        }
        let Ok(mut pipeline) = self.pipeline.lock() else {
            return (0, 0, 0);
        };
        pipeline
            .take()
            .map(|s| (ms(s.p50_us), ms(s.p95_us), ms(s.max_us)))
            .unwrap_or((0, 0, 0))
    }

    /// Hand a frame from `source` to every client shown its window.
    pub async fn broadcast_video(&self, data: Vec<u8>, source: Source) {
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
        let (window, note) = {
            let mut windows = self.windows.lock().unwrap_or_else(|e| e.into_inner());
            let window = windows.resolve(source);
            if let (Some(w), Some(pid)) = (window, source) {
                windows.note_drawn(w, pid);
            }
            let note = windows.note_primary(source, std::time::Instant::now());
            if note.primary {
                self.primary_window.store(
                    u32::from(window.unwrap_or(WINDOW_DEFAULT)),
                    Ordering::Relaxed,
                );
                self.primary_pid.store(source.unwrap_or(0), Ordering::Relaxed);
            }
            (window, note)
        };
        let data = Bytes::from(data);
        let sessions = self.sessions.lock().await;
        if note.switched {
            // Clients that never subscribed are now shown another encoder:
            // nothing they hold predicts it, ref(d-0085).
            info!("primary picture is now encoder {source:?}");
            let mut any = false;
            for session in sessions.values() {
                if session.subscription() == Subscription::Legacy {
                    session.restart_picture();
                    session
                        .encoder_pid
                        .store(source.unwrap_or(0), Ordering::Relaxed);
                    any = true;
                }
            }
            if any && let Some(tx) = self.cmd_tx.get() {
                let _ = tx.send(keyframe_request(source));
            }
        }
        for session in sessions.values() {
            let routed = route(session.subscription(), window, note.primary);
            // A client shown this frame is shown this encoder, whenever it
            // subscribed. The pid used to be fixed at subscribe time, and a
            // client that subscribed before the game drew its first frame (the
            // usual order: the window opens, the client subscribes, the
            // encoder draws) kept pid 0 for good, so a pause had no encoder
            // to go to and was dropped, ref(d-0087).
            if routed.is_some()
                && let Some(pid) = source
                && session.encoder_pid.load(Ordering::Relaxed) != pid
            {
                session.encoder_pid.store(pid, Ordering::Relaxed);
            }
            match routed {
                Some(WINDOW_DEFAULT) => session.send_video_frame(MediaItem::Coded(data.clone())),
                Some(w) => session.send_video_frame(MediaItem::Windowed(w, data.clone())),
                None => {}
            }
        }
    }

    /// Encoder `pid` said which launch it draws for, ref(d-0085).
    pub fn note_encoder_launch(&self, pid: u32, launch: String) {
        self.windows
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .note_launch(pid, launch);
    }

    /// One message from nescope on the input socket that is not stats:
    /// cursor updates and the box's windows, in the order nescope sent them.
    /// An empty one means nescope has (re)connected.
    pub async fn on_nescope(&self, message: Vec<u8>) {
        use nesprotocol::window::{MSG_CURSOR_WINDOW, MSG_WINDOW_PID, decode_window_pid};
        let Some(&kind) = message.first() else {
            self.compositor_restarted().await;
            return;
        };
        match kind {
            nesprotocol::input::CURSOR_UPDATE | nesprotocol::input::CURSOR_IMAGE => {
                self.broadcast_cursor(message).await
            }
            MSG_CURSOR_WINDOW => match nesprotocol::window::decode_subscribe(&message[1..]) {
                Some(w) => self.cursor_window.store(u32::from(w), Ordering::Relaxed),
                None => debug!("unreadable cursor window"),
            },
            MSG_WINDOW_PID => match decode_window_pid(&message[1..]) {
                Some((window, pid)) => {
                    debug!("window {window} is process {pid}");
                    self.windows
                        .lock()
                        .unwrap_or_else(|e| e.into_inner())
                        .bind_pid(window, pid);
                }
                None => debug!("unreadable window pid"),
            },
            _ => match WindowEvent::decode(kind, &message[1..]) {
                Some(event) => self.window_event(event, message).await,
                None => debug!("unknown message {kind:#04x} from nescope"),
            },
        }
    }

    /// Record a lifecycle event and pass it to every client with a windows
    /// stream.
    async fn window_event(&self, event: WindowEvent, message: Vec<u8>) {
        match &event {
            WindowEvent::Opened { window, launch_id, title, .. } => {
                info!("window {window} opened: launch {launch_id:?}, {title:?}")
            }
            WindowEvent::Closed { window } => info!("window {window} closed"),
            _ => {}
        }
        self.windows
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .apply(&event);
        let sessions = self.sessions.lock().await;
        for session in sessions.values() {
            if session.subscription() != Subscription::Legacy {
                session.send_window_message(message.clone());
            }
        }
    }

    /// nescope connected again, so the box's compositor is a new one and every
    /// window id before now means nothing: say each window closed, and end
    /// every subscription to one.
    async fn compositor_restarted(&self) {
        let closed = self
            .windows
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .reset();
        self.cursor_window.store(0, Ordering::Relaxed);
        if closed.is_empty() {
            return;
        }
        info!("compositor restarted; {} window(s) gone", closed.len());
        let sessions = self.sessions.lock().await;
        for session in sessions.values() {
            let sub = session.subscription();
            if sub == Subscription::Legacy {
                continue;
            }
            for window in &closed {
                let mut m = Vec::new();
                nesprotocol::window::encode_event_message(
                    &mut m,
                    &WindowEvent::Closed { window: *window },
                );
                session.send_window_message(m);
            }
            if let Subscription::Window(_) = sub
                && let Ok(mut s) = session.subscription.lock()
            {
                *s = Subscription::Torn;
            }
        }
    }

    /// A client asked to be shown `window`.
    ///
    /// The first subscription opens its windows stream, starting with every
    /// window already open so a late client learns the box as it stands.
    pub async fn subscribe(
        &self,
        client: iroh::EndpointId,
        window: WindowId,
        idr_cmd_tx: &tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
    ) {
        let snapshot = self
            .windows
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .snapshot();
        let sessions = self.sessions.lock().await;
        let Some(session) = sessions.get(&client) else {
            return;
        };
        let encoder = self
            .windows
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .encoder_of(window);
        let before = session.subscribe(Subscription::Window(window), encoder, idr_cmd_tx);
        if before == Subscription::Legacy {
            for event in snapshot {
                let mut m = Vec::new();
                nesprotocol::window::encode_event_message(&mut m, &event);
                session.send_window_message(m);
            }
        }
    }

    /// Serve subscribe requests from every client's control reader. Run once,
    /// on a task of its own.
    pub async fn serve_subscriptions(
        self: Arc<Self>,
        idr_cmd_tx: tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
    ) {
        let _ = self.cmd_tx.set(idr_cmd_tx.clone());
        let rx = self
            .subscribe_rx
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take();
        let Some(mut rx) = rx else {
            return;
        };
        while let Some((client, window)) = rx.recv().await {
            self.subscribe(client, window, &idr_cmd_tx).await;
        }
    }

    /// Hand a PyroWave frame to every client.
    ///
    /// Counted with the delta bytes: every PyroWave frame is intra, and
    /// counting them as keyframes would report sixty keyframes a second, which
    /// describes nothing.
    pub async fn broadcast_pyrowave(&self, frame: PyroFrame) {
        self.note_pipeline_ts(frame.meta.captured_us);
        self.video_delta_bytes
            .fetch_add(frame.data.len() as u64, Ordering::Relaxed);
        let item = MediaItem::PyroWave(Arc::new(frame));
        let sessions = self.sessions.lock().await;
        // PyroWave has no windowed form: it is window 0's, ref(d-0085).
        for session in sessions.values() {
            if matches!(
                session.subscription(),
                Subscription::Legacy | Subscription::Window(WINDOW_DEFAULT)
            ) {
                session.send_video_frame(item.clone());
            }
        }
    }

    /// PyroWave frames skipped across every client since the last call.
    pub async fn take_pyro_skipped(&self) -> u64 {
        let sessions = self.sessions.lock().await;
        sessions
            .values()
            .map(ClientSession::take_pyro_skipped)
            .sum()
    }

    /// The PyroWave packet size every streaming client can carry: the smallest
    /// of theirs, since one encoder serves them all. `None` with no client
    /// streaming.
    pub async fn pyro_packet_size(&self) -> Option<usize> {
        let sessions = self.sessions.lock().await;
        sessions
            .values()
            .filter_map(ClientSession::pyro_packet_limit)
            .min()
    }

    pub async fn broadcast_audio(&self, data: Vec<u8>) {
        // Counted before the early return, so the figure measures what neswire
        // delivered rather than what a client happened to be around for. A hub
        // with no client still knows whether audio is being produced.
        self.audio_bytes
            .fetch_add(data.len() as u64, Ordering::Relaxed);
        let data = Bytes::from(data);
        let sessions = self.sessions.lock().await;
        for session in sessions.values() {
            session.send_audio_packet(data.clone());
        }
    }

    pub async fn broadcast_cursor(&self, data: Vec<u8>) {
        let sessions = self.sessions.lock().await;
        if sessions.is_empty() {
            return;
        }
        // To the clients shown the window the cursor describes, ref(d-0085).
        let window = self.cursor_window.load(Ordering::Relaxed) as WindowId;
        for session in sessions.values() {
            if wants_cursor(session.subscription(), window) {
                session.send_cursor_data(data.clone());
            }
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
    /// The send-queue depth of every streaming client, in bytes.
    ///
    /// Separate from `worst_report` because it needs nothing from the far end
    /// and so is not tied to the once-a-second cadence a receiver report
    /// imposes. That independence is the whole question the rate probe exists
    /// to settle: a control loop can only usefully run as fast as the thing it
    /// steers responds, but it is not otherwise limited by how often the client
    /// talks.
    pub async fn backlog_bytes(&self) -> Vec<u64> {
        self.sessions
            .lock()
            .await
            .values()
            .filter_map(|s| s.path_view().backlog_bytes)
            .collect()
    }

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

    /// Which clients have somewhere to send a picture: the paths the rate
    /// controller has to answer to.
    pub async fn streaming_clients(&self) -> Vec<iroh::EndpointId> {
        self.sessions
            .lock()
            .await
            .iter()
            .filter(|(_, s)| s.is_streaming())
            .map(|(id, _)| *id)
            .collect()
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

    /// A video payload captured `ago_us` before now, on the clock the hub reads.
    fn payload(ago_us: u64) -> Vec<u8> {
        nesprotocol::encode_video_payload(
            &nesprotocol::VideoHead {
                codec: 0,
                flags: 0,
                captured_us: nesprotocol::clock::monotonic_us() - ago_us,
                width: 1920,
                height: 1080,
            },
            &[0u8; 32],
        )
    }

    #[test]
    fn a_second_with_no_frames_reports_nothing() {
        let mgr = SessionManager::new(0);
        assert_eq!(mgr.pipeline_delays(), (0, 0, 0));
    }

    #[test]
    fn a_steady_pipeline_reports_no_variation() {
        // A pipeline taking the same time on every frame reads as no
        // variation, however long that time is.
        let mgr = SessionManager::new(0);
        for _ in 0..60 {
            mgr.note_pipeline_delay(&payload(40_000));
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
        let mgr = SessionManager::new(0);
        mgr.note_pipeline_delay(&payload(0));
        assert!(mgr.pipeline_delays().0 == 0);
        assert_eq!(mgr.pipeline_delays(), (0, 0, 0));
    }

    #[test]
    fn a_truncated_payload_is_ignored_rather_than_misread() {
        let mgr = SessionManager::new(0);
        mgr.note_pipeline_delay(&[0u8, 0u8, 1u8]);
        assert_eq!(mgr.pipeline_delays(), (0, 0, 0));
    }
}

#[cfg(test)]
mod input_batch_tests {
    use super::split_input_events;
    use nesprotocol::input::{
        encode_key_event, encode_mouse_button, encode_mouse_move, encode_mouse_wheel,
    };

    /// The bug this exists for: a four-byte key event read as three bytes
    /// forwards a truncated keycode and leaves the offset one short, so the
    /// next event is read from inside this one. Built with the encoder rather
    /// than by hand, so the widths cannot drift apart again.
    #[test]
    fn a_key_event_survives_the_round_trip_whole() {
        let mut batch = Vec::new();
        // A keycode above 255, so a lost high byte cannot go unnoticed.
        encode_key_event(&mut batch, true, 0x1234);
        let events = split_input_events(&batch);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0], batch, "the event was not forwarded intact");
    }

    /// The consequence of getting a width wrong, and the symptom that was
    /// actually seen: a keycode read as though it were an event type.
    #[test]
    fn every_event_in_a_batch_is_recovered() {
        let mut batch = Vec::new();
        let mut expected = Vec::new();
        for (down, code) in [(true, 29u16), (true, 42), (true, 32), (false, 32)] {
            let mut one = Vec::new();
            encode_key_event(&mut one, down, code);
            batch.extend_from_slice(&one);
            expected.push(one);
        }
        assert_eq!(
            split_input_events(&batch),
            expected,
            "a batch of key events did not come back as the events that went in"
        );
    }

    #[test]
    fn mixed_events_keep_their_boundaries() {
        let mut batch = Vec::new();
        let mut expected = Vec::new();
        let mut add = |f: &dyn Fn(&mut Vec<u8>), batch: &mut Vec<u8>| {
            let mut one = Vec::new();
            f(&mut one);
            batch.extend_from_slice(&one);
            expected.push(one);
        };
        add(&|b| encode_key_event(b, true, 0x0102), &mut batch);
        add(&|b| encode_mouse_move(b, -300, 42), &mut batch);
        add(&|b| encode_mouse_button(b, 1, true), &mut batch);
        add(&|b| encode_mouse_wheel(b, 0, -120), &mut batch);
        add(&|b| encode_key_event(b, false, 0x0102), &mut batch);
        assert_eq!(split_input_events(&batch), expected);
    }

    /// A truncated batch must stop, not read past the end or invent an event.
    #[test]
    fn a_cut_off_event_is_dropped_rather_than_guessed_at() {
        let mut batch = Vec::new();
        encode_key_event(&mut batch, true, 0x1234);
        let whole = batch.clone();
        encode_key_event(&mut batch, true, 0x5678);
        batch.pop();
        let events = split_input_events(&batch);
        assert_eq!(events, vec![whole], "the half event was not discarded");
    }

    #[test]
    fn an_unknown_event_type_stops_the_batch_rather_than_the_process() {
        let events = split_input_events(&[0xAA, 0xBB, 0xCC]);
        assert!(events.is_empty());
    }
}

#[cfg(test)]
mod pyrowave_request_tests {
    use super::{PyroWaveGate, pyrowave_request};
    use nesprotocol::pyrowave::{CHROMA_420, CHROMA_444};
    use nesprotocol::{CODEC_PYROWAVE, DEPTH_8, DEPTH_10, EncodeSettings, RC_CBR, RC_CQP};
    use std::sync::Arc;
    use std::sync::atomic::AtomicBool;

    fn gate(ok: bool) -> PyroWaveGate {
        PyroWaveGate {
            ok: Arc::new(AtomicBool::new(ok)),
            default_kbps: 300_000,
        }
    }

    fn request(value: u32) -> EncodeSettings {
        EncodeSettings {
            codec: CODEC_PYROWAVE,
            rate_control: RC_CBR,
            value,
            bit_depth: None,
            chroma: None,
            packet_size: Some(9999),
        }
    }

    /// The opt-in is only as safe as this: a client that never said it
    /// decodes the format must not get it by asking.
    #[test]
    fn a_client_without_the_format_is_refused() {
        assert!(pyrowave_request(request(100_000), &gate(false)).is_err());
    }

    #[test]
    fn no_rate_means_the_hubs_default() {
        let s = pyrowave_request(request(0), &gate(true)).unwrap();
        assert_eq!(s.value, 300_000);
        let s = pyrowave_request(request(150_000), &gate(true)).unwrap();
        assert_eq!(s.value, 150_000, "a named rate is not overruled");
    }

    /// The client cannot see the path, so whatever packet size it sent is not
    /// passed on; the forwarder names one.
    #[test]
    fn the_clients_packet_size_is_not_trusted() {
        let s = pyrowave_request(request(0), &gate(true)).unwrap();
        assert_eq!(s.packet_size, None);
        assert_eq!((s.bit_depth, s.chroma), (Some(DEPTH_8), Some(CHROMA_420)));

        let mut r = request(0);
        r.bit_depth = Some(DEPTH_10);
        r.chroma = Some(CHROMA_444);
        let s = pyrowave_request(r, &gate(true)).unwrap();
        assert_eq!((s.bit_depth, s.chroma), (Some(DEPTH_10), Some(CHROMA_444)));
    }

    #[test]
    fn constant_quality_is_not_a_pyrowave_mode() {
        let mut r = request(0);
        r.rate_control = RC_CQP;
        assert!(pyrowave_request(r, &gate(true)).is_err());
    }
}
