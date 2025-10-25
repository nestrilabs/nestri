use crate::input::controller::ControllerManager;
use crate::p2p::p2p::NestriConnection;
use crate::p2p::p2p_protocol_stream::NestriStreamProtocol;
use crate::proto::proto::proto_message::Payload;
use crate::proto::proto::{
    ProtoControllerAttach, ProtoControllerRumble, ProtoIce, ProtoMessage, ProtoSdp,
    ProtoServerPushStream, RtcIceCandidateInit, RtcSessionDescriptionInit,
};
use anyhow::Result;
use glib::subclass::prelude::*;
use gstreamer::glib;
use gstreamer::prelude::*;
use gstreamer_webrtc::{WebRTCSDPType, WebRTCSessionDescription, gst_sdp};
use gstrswebrtc::signaller::{Signallable, SignallableImpl};
use parking_lot::RwLock as PLRwLock;
use prost::Message;
use std::sync::{Arc, LazyLock};
use tokio::sync::{Mutex, mpsc};

pub struct Signaller {
    stream_room: PLRwLock<Option<String>>,
    stream_protocol: PLRwLock<Option<Arc<NestriStreamProtocol>>>,
    wayland_src: PLRwLock<Option<Arc<gstreamer::Element>>>,
    data_channel: PLRwLock<Option<Arc<gstreamer_webrtc::WebRTCDataChannel>>>,
    controller_manager: PLRwLock<Option<Arc<ControllerManager>>>,
    rumble_rx: Mutex<Option<mpsc::Receiver<(u32, u16, u16, u16, String)>>>,
    attach_rx: Mutex<Option<mpsc::Receiver<ProtoControllerAttach>>>,
}
impl Default for Signaller {
    fn default() -> Self {
        Self {
            stream_room: PLRwLock::new(None),
            stream_protocol: PLRwLock::new(None),
            wayland_src: PLRwLock::new(None),
            data_channel: PLRwLock::new(None),
            controller_manager: PLRwLock::new(None),
            rumble_rx: Mutex::new(None),
            attach_rx: Mutex::new(None),
        }
    }
}
impl Signaller {
    pub async fn set_nestri_connection(&self, nestri_conn: NestriConnection) -> Result<()> {
        let stream_protocol = NestriStreamProtocol::new(nestri_conn).await?;
        *self.stream_protocol.write() = Some(Arc::new(stream_protocol));
        Ok(())
    }

    pub fn set_stream_room(&self, room: String) {
        *self.stream_room.write() = Some(room);
    }

    fn get_stream_protocol(&self) -> Option<Arc<NestriStreamProtocol>> {
        self.stream_protocol.read().clone()
    }

    pub fn set_wayland_src(&self, wayland_src: Arc<gstreamer::Element>) {
        *self.wayland_src.write() = Some(wayland_src);
    }

    pub fn get_wayland_src(&self) -> Option<Arc<gstreamer::Element>> {
        self.wayland_src.read().clone()
    }

    pub fn set_controller_manager(&self, controller_manager: Arc<ControllerManager>) {
        *self.controller_manager.write() = Some(controller_manager);
    }

    pub fn get_controller_manager(&self) -> Option<Arc<ControllerManager>> {
        self.controller_manager.read().clone()
    }

    pub async fn set_rumble_rx(&self, rumble_rx: mpsc::Receiver<(u32, u16, u16, u16, String)>) {
        *self.rumble_rx.lock().await = Some(rumble_rx);
    }

    pub async fn take_rumble_rx(&self) -> Option<mpsc::Receiver<(u32, u16, u16, u16, String)>> {
        self.rumble_rx.lock().await.take()
    }

    pub async fn set_attach_rx(
        &self,
        attach_rx: mpsc::Receiver<crate::proto::proto::ProtoControllerAttach>,
    ) {
        *self.attach_rx.lock().await = Some(attach_rx);
    }

    pub async fn take_attach_rx(
        &self,
    ) -> Option<mpsc::Receiver<crate::proto::proto::ProtoControllerAttach>> {
        self.attach_rx.lock().await.take()
    }

    pub fn set_data_channel(&self, data_channel: gstreamer_webrtc::WebRTCDataChannel) {
        *self.data_channel.write() = Some(Arc::new(data_channel));
    }

    pub fn get_data_channel(&self) -> Option<Arc<gstreamer_webrtc::WebRTCDataChannel>> {
        self.data_channel.read().clone()
    }

    /// Helper method to clean things up
    fn register_callbacks(&self) {
        let Some(stream_protocol) = self.get_stream_protocol() else {
            gstreamer::error!(gstreamer::CAT_DEFAULT, "Stream protocol not set");
            return;
        };
        {
            let self_obj = self.obj().clone();
            stream_protocol.register_callback("answer", move |msg| {
                if let Some(payload) = msg.payload {
                    match payload {
                        Payload::Sdp(sdp) => {
                            if let Some(sdp) = sdp.sdp {
                                let sdp = gst_sdp::SDPMessage::parse_buffer(sdp.sdp.as_bytes())
                                    .map_err(|e| {
                                        anyhow::anyhow!("Invalid SDP in 'answer': {e:?}")
                                    })?;
                                let answer =
                                    WebRTCSessionDescription::new(WebRTCSDPType::Answer, sdp);
                                return Ok(self_obj.emit_by_name::<()>(
                                    "session-description",
                                    &[&"unique-session-id", &answer],
                                ));
                            }
                        }
                        _ => {
                            tracing::warn!("Unexpected payload type for answer");
                            return Ok(());
                        }
                    }
                } else {
                    anyhow::bail!("Failed to decode answer message");
                }
                Ok(())
            });
        }
        {
            let self_obj = self.obj().clone();
            stream_protocol.register_callback("ice-candidate", move |msg| {
                if let Some(payload) = msg.payload {
                    match payload {
                        Payload::Ice(ice) => {
                            if let Some(candidate) = ice.candidate {
                                let sdp_m_line_index = candidate.sdp_m_line_index.unwrap_or(0);
                                return Ok(self_obj.emit_by_name::<()>(
                                    "handle-ice",
                                    &[
                                        &"unique-session-id",
                                        &sdp_m_line_index,
                                        &candidate.sdp_mid,
                                        &candidate.candidate,
                                    ],
                                ));
                            }
                        }
                        _ => {
                            tracing::warn!("Unexpected payload type for ice-candidate");
                            return Ok(());
                        }
                    }
                } else {
                    anyhow::bail!("Failed to decode ICE message");
                }
                Ok(())
            });
        }
        {
            let self_obj = self.obj().clone();
            stream_protocol.register_callback("push-stream-ok", move |msg| {
                if let Some(payload) = msg.payload {
                    return match payload {
                        Payload::ServerPushStream(_res) => {
                            // Send our SDP offer
                            Ok(self_obj.emit_by_name::<()>(
                                "session-requested",
                                &[
                                    &"unique-session-id",
                                    &"consumer-identifier",
                                    &None::<WebRTCSessionDescription>,
                                ],
                            ))
                        }
                        _ => {
                            tracing::warn!("Unexpected payload type for push-stream-ok");
                            Ok(())
                        }
                    };
                } else {
                    anyhow::bail!("Failed to decode answer");
                }
            });
        }
        {
            let self_obj = self.obj().clone();
            // After creating webrtcsink
            self_obj.connect_closure(
                "webrtcbin-ready",
                false,
                glib::closure!(
                    move |signaller: &super::NestriSignaller,
                          _consumer_identifier: &str,
                          webrtcbin: &gstreamer::Element| {
                        gstreamer::info!(gstreamer::CAT_DEFAULT, "Adding data channels");
                        // Create data channels on webrtcbin
                        let data_channel = Some(
                            webrtcbin.emit_by_name::<gstreamer_webrtc::WebRTCDataChannel>(
                                "create-data-channel",
                                &[
                                    &"nestri-data-channel",
                                    &gstreamer::Structure::builder("config")
                                        .field("ordered", &true)
                                        .field("max-retransmits", &2u32)
                                        .field("priority", "high")
                                        .field("protocol", "raw")
                                        .build(),
                                ],
                            ),
                        );
                        if let Some(data_channel) = data_channel {
                            gstreamer::info!(gstreamer::CAT_DEFAULT, "Data channel created");
                            if let Some(wayland_src) = signaller.imp().get_wayland_src() {
                                signaller.imp().set_data_channel(data_channel.clone());

                                let signaller = signaller.clone();
                                let data_channel = Arc::new(data_channel);
                                let wayland_src = wayland_src.clone();

                                // Spawn async task to take the receiver and set up
                                tokio::spawn(async move {
                                    let rumble_rx = signaller.imp().take_rumble_rx().await;
                                    let attach_rx = signaller.imp().take_attach_rx().await;
                                    let controller_manager =
                                        signaller.imp().get_controller_manager();

                                    setup_data_channel(
                                        controller_manager,
                                        rumble_rx,
                                        attach_rx,
                                        data_channel,
                                        &wayland_src,
                                    );
                                });
                            } else {
                                gstreamer::error!(
                                    gstreamer::CAT_DEFAULT,
                                    "Wayland display source not set"
                                );
                            }
                        } else {
                            gstreamer::error!(
                                gstreamer::CAT_DEFAULT,
                                "Failed to create data channel"
                            );
                        }
                    }
                ),
            );
        }
    }
}
impl SignallableImpl for Signaller {
    fn start(&self) {
        gstreamer::info!(gstreamer::CAT_DEFAULT, "Signaller started");

        // Register message callbacks
        self.register_callbacks();

        // Subscribe to reconnection notifications
        // TODO: Re-implement reconnection handling

        let Some(stream_room) = self.stream_room.read().clone() else {
            gstreamer::error!(gstreamer::CAT_DEFAULT, "Stream room not set");
            return;
        };

        let Some(stream_protocol) = self.get_stream_protocol() else {
            gstreamer::error!(gstreamer::CAT_DEFAULT, "Stream protocol not set");
            return;
        };

        let push_msg = crate::proto::create_message(
            Payload::ServerPushStream(ProtoServerPushStream {
                room_name: stream_room,
            }),
            "push-stream-room",
            None,
        );
        if let Err(e) = stream_protocol.send_message(&push_msg) {
            tracing::error!("Failed to send push stream room message: {:?}", e);
        }
    }

    fn stop(&self) {
        gstreamer::info!(gstreamer::CAT_DEFAULT, "Signaller stopped");
    }

    fn send_sdp(&self, _session_id: &str, sdp: &WebRTCSessionDescription) {
        let Some(stream_protocol) = self.get_stream_protocol() else {
            gstreamer::error!(gstreamer::CAT_DEFAULT, "Stream protocol not set");
            return;
        };

        let sdp_msg = crate::proto::create_message(
            Payload::Sdp(ProtoSdp {
                sdp: Some(RtcSessionDescriptionInit {
                    sdp: sdp.sdp().as_text().unwrap(),
                    r#type: "offer".to_string(),
                }),
            }),
            "offer",
            None,
        );
        if let Err(e) = stream_protocol.send_message(&sdp_msg) {
            tracing::error!("Failed to send SDP message: {:?}", e);
        }
    }

    fn add_ice(
        &self,
        _session_id: &str,
        candidate: &str,
        sdp_m_line_index: u32,
        sdp_mid: Option<String>,
    ) {
        let Some(stream_protocol) = self.get_stream_protocol() else {
            gstreamer::error!(gstreamer::CAT_DEFAULT, "Stream protocol not set");
            return;
        };

        let candidate_init = RtcIceCandidateInit {
            candidate: candidate.to_string(),
            sdp_mid,
            sdp_m_line_index: Some(sdp_m_line_index),
            ..Default::default() //username_fragment: Some(session_id.to_string()), TODO: required?
        };
        let ice_msg = crate::proto::create_message(
            Payload::Ice(ProtoIce {
                candidate: Some(candidate_init),
            }),
            "ice-candidate",
            None,
        );
        if let Err(e) = stream_protocol.send_message(&ice_msg) {
            tracing::error!("Failed to send ICE candidate message: {:?}", e);
        }
    }

    fn end_session(&self, session_id: &str) {
        gstreamer::info!(gstreamer::CAT_DEFAULT, "Ending session: {}", session_id);
    }
}
#[glib::object_subclass]
impl ObjectSubclass for Signaller {
    const NAME: &'static str = "NestriSignaller";
    type Type = super::NestriSignaller;
    type ParentType = glib::Object;
    type Interfaces = (Signallable,);
}
impl ObjectImpl for Signaller {
    fn properties() -> &'static [glib::ParamSpec] {
        static PROPS: LazyLock<Vec<glib::ParamSpec>> = LazyLock::new(|| {
            vec![
                glib::ParamSpecBoolean::builder("manual-sdp-munging")
                    .nick("Manual SDP munging")
                    .blurb("Whether the signaller manages SDP munging itself")
                    .default_value(false)
                    .read_only()
                    .build(),
            ]
        });

        PROPS.as_ref()
    }
    fn property(&self, _id: usize, pspec: &glib::ParamSpec) -> glib::Value {
        match pspec.name() {
            "manual-sdp-munging" => false.to_value(),
            _ => unimplemented!(),
        }
    }
}

fn setup_data_channel(
    controller_manager: Option<Arc<ControllerManager>>,
    rumble_rx: Option<mpsc::Receiver<(u32, u16, u16, u16, String)>>, // (slot, strong, weak, duration_ms, session_id)
    attach_rx: Option<mpsc::Receiver<ProtoControllerAttach>>,
    data_channel: Arc<gstreamer_webrtc::WebRTCDataChannel>,
    wayland_src: &gstreamer::Element,
) {
    let wayland_src = wayland_src.clone();
    let (tx, mut rx) = mpsc::unbounded_channel::<Vec<u8>>();

    // Spawn async processor
    tokio::spawn(async move {
        while let Some(data) = rx.recv().await {
            match ProtoMessage::decode(data.as_slice()) {
                Ok(msg_wrapper) => {
                    if let Some(message_base) = msg_wrapper.message_base {
                        if message_base.payload_type == "input" {
                            if let Some(input_data) = msg_wrapper.payload {
                                if let Some(event) = handle_input_message(input_data) {
                                    // Send the event to wayland source, result bool is ignored
                                    let _ = wayland_src.send_event(event);
                                }
                            }
                        } else if message_base.payload_type == "controllerInput" {
                            if let Some(controller_manager) = &controller_manager {
                                if let Some(input_data) = msg_wrapper.payload {
                                    let _ = controller_manager.send_command(input_data).await;
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    tracing::error!("Failed to decode input message: {:?}", e);
                }
            }
        }
    });

    // Spawn rumble sender
    if let Some(mut rumble_rx) = rumble_rx {
        let data_channel_clone = data_channel.clone();
        tokio::spawn(async move {
            while let Some((slot, strong, weak, duration_ms, session_id)) = rumble_rx.recv().await {
                let rumble_msg = crate::proto::create_message(
                    Payload::ControllerRumble(ProtoControllerRumble {
                        session_slot: slot as i32,
                        session_id: session_id,
                        low_frequency: weak as i32,
                        high_frequency: strong as i32,
                        duration: duration_ms as i32,
                    }),
                    "controllerInput",
                    None,
                );

                let data = rumble_msg.encode_to_vec();
                let bytes = glib::Bytes::from_owned(data);

                if let Err(e) = data_channel_clone.send_data_full(Some(&bytes)) {
                    tracing::warn!("Failed to send rumble data: {}", e);
                }
            }
        });
    }

    // Spawn attach sender
    if let Some(mut attach_rx) = attach_rx {
        let data_channel_clone = data_channel.clone();
        tokio::spawn(async move {
            while let Some(attach_msg) = attach_rx.recv().await {
                let proto_msg = crate::proto::create_message(
                    Payload::ControllerAttach(attach_msg),
                    "controllerInput",
                    None,
                );

                let data = proto_msg.encode_to_vec();
                let bytes = glib::Bytes::from_owned(data);

                if let Err(e) = data_channel_clone.send_data_full(Some(&bytes)) {
                    tracing::warn!("Failed to send controller attach data: {}", e);
                }
            }
        });
    }

    data_channel.connect_on_message_data(move |_data_channel, data| {
        if let Some(data) = data {
            let _ = tx.send(data.to_vec());
        }
    });
}

fn handle_input_message(payload: Payload) -> Option<gstreamer::Event> {
    match payload {
        Payload::MouseMove(data) => {
            let structure = gstreamer::Structure::builder("MouseMoveRelative")
                .field("pointer_x", data.x as f64)
                .field("pointer_y", data.y as f64)
                .build();

            Some(gstreamer::event::CustomUpstream::new(structure))
        }
        Payload::MouseMoveAbs(data) => {
            let structure = gstreamer::Structure::builder("MouseMoveAbsolute")
                .field("pointer_x", data.x as f64)
                .field("pointer_y", data.y as f64)
                .build();

            Some(gstreamer::event::CustomUpstream::new(structure))
        }
        Payload::KeyDown(data) => {
            let structure = gstreamer::Structure::builder("KeyboardKey")
                .field("key", data.key as u32)
                .field("pressed", true)
                .build();

            Some(gstreamer::event::CustomUpstream::new(structure))
        }
        Payload::KeyUp(data) => {
            let structure = gstreamer::Structure::builder("KeyboardKey")
                .field("key", data.key as u32)
                .field("pressed", false)
                .build();

            Some(gstreamer::event::CustomUpstream::new(structure))
        }
        Payload::MouseWheel(data) => {
            let structure = gstreamer::Structure::builder("MouseAxis")
                .field("x", data.x as f64)
                .field("y", data.y as f64)
                .build();

            Some(gstreamer::event::CustomUpstream::new(structure))
        }
        Payload::MouseKeyDown(data) => {
            let structure = gstreamer::Structure::builder("MouseButton")
                .field("button", data.key as u32)
                .field("pressed", true)
                .build();

            Some(gstreamer::event::CustomUpstream::new(structure))
        }
        Payload::MouseKeyUp(data) => {
            let structure = gstreamer::Structure::builder("MouseButton")
                .field("button", data.key as u32)
                .field("pressed", false)
                .build();

            Some(gstreamer::event::CustomUpstream::new(structure))
        }
        _ => None,
    }
}
