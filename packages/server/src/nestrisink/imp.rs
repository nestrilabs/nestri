use crate::messages::{
    AnswerType, JoinerType, MessageAnswer, MessageBase, MessageICE, MessageJoin, MessageSDP,
    decode_message_as, encode_message,
};
use crate::proto::proto::proto_input::InputType::{
    KeyDown, KeyUp, MouseKeyDown, MouseKeyUp, MouseMove, MouseMoveAbs, MouseWheel,
};
use crate::proto::proto::{ProtoInput, ProtoMessageInput};
use crate::websocket::NestriWebSocket;
use atomic_refcell::AtomicRefCell;
use glib::subclass::prelude::*;
use gst::glib;
use gst::prelude::*;
use gst_webrtc::{WebRTCSDPType, WebRTCSessionDescription, gst_sdp};
use gstrswebrtc::signaller::{Signallable, SignallableImpl};
use parking_lot::RwLock as PLRwLock;
use prost::Message;
use std::sync::{Arc, LazyLock};
use webrtc::ice_transport::ice_candidate::RTCIceCandidateInit;
use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;

pub struct Signaller {
    nestri_ws: PLRwLock<Option<Arc<NestriWebSocket>>>,
    wayland_src: PLRwLock<Option<Arc<gst::Element>>>,
    data_channel: AtomicRefCell<Option<gst_webrtc::WebRTCDataChannel>>,
}
impl Default for Signaller {
    fn default() -> Self {
        Self {
            nestri_ws: PLRwLock::new(None),
            wayland_src: PLRwLock::new(None),
            data_channel: AtomicRefCell::new(None),
        }
    }
}
impl Signaller {
    pub fn set_nestri_ws(&self, nestri_ws: Arc<NestriWebSocket>) {
        *self.nestri_ws.write() = Some(nestri_ws);
    }

    pub fn set_wayland_src(&self, wayland_src: Arc<gst::Element>) {
        *self.wayland_src.write() = Some(wayland_src);
    }

    pub fn get_wayland_src(&self) -> Option<Arc<gst::Element>> {
        self.wayland_src.read().clone()
    }

    pub fn set_data_channel(&self, data_channel: gst_webrtc::WebRTCDataChannel) {
        match self.data_channel.try_borrow_mut() {
            Ok(mut dc) => *dc = Some(data_channel),
            Err(_) => gst::warning!(
                gst::CAT_DEFAULT,
                "Failed to set data channel - already borrowed"
            ),
        }
    }

    /// Helper method to clean things up
    fn register_callbacks(&self) {
        let nestri_ws = {
            self.nestri_ws
                .read()
                .clone()
                .expect("NestriWebSocket not set")
        };
        {
            let self_obj = self.obj().clone();
            let _ = nestri_ws.register_callback("sdp", move |data| {
                if let Ok(message) = decode_message_as::<MessageSDP>(data) {
                    let sdp =
                        gst_sdp::SDPMessage::parse_buffer(message.sdp.sdp.as_bytes()).unwrap();
                    let answer = WebRTCSessionDescription::new(WebRTCSDPType::Answer, sdp);
                    self_obj.emit_by_name::<()>(
                        "session-description",
                        &[&"unique-session-id", &answer],
                    );
                } else {
                    gst::error!(gst::CAT_DEFAULT, "Failed to decode SDP message");
                }
            });
        }
        {
            let self_obj = self.obj().clone();
            let _ = nestri_ws.register_callback("ice", move |data| {
                if let Ok(message) = decode_message_as::<MessageICE>(data) {
                    let candidate = message.candidate;
                    let sdp_m_line_index = candidate.sdp_mline_index.unwrap_or(0) as u32;
                    let sdp_mid = candidate.sdp_mid;

                    self_obj.emit_by_name::<()>(
                        "handle-ice",
                        &[
                            &"unique-session-id",
                            &sdp_m_line_index,
                            &sdp_mid,
                            &candidate.candidate,
                        ],
                    );
                } else {
                    gst::error!(gst::CAT_DEFAULT, "Failed to decode ICE message");
                }
            });
        }
        {
            let self_obj = self.obj().clone();
            let _ = nestri_ws.register_callback("answer", move |data| {
                if let Ok(answer) = decode_message_as::<MessageAnswer>(data) {
                    gst::info!(gst::CAT_DEFAULT, "Received answer: {:?}", answer);
                    match answer.answer_type {
                        AnswerType::AnswerOK => {
                            gst::info!(gst::CAT_DEFAULT, "Received OK answer");
                            // Send our SDP offer
                            self_obj.emit_by_name::<()>(
                                "session-requested",
                                &[
                                    &"unique-session-id",
                                    &"consumer-identifier",
                                    &None::<WebRTCSessionDescription>,
                                ],
                            );
                        }
                        AnswerType::AnswerInUse => {
                            gst::error!(gst::CAT_DEFAULT, "Room is in use by another node");
                        }
                        AnswerType::AnswerOffline => {
                            gst::warning!(gst::CAT_DEFAULT, "Room is offline");
                        }
                    }
                } else {
                    gst::error!(gst::CAT_DEFAULT, "Failed to decode answer");
                }
            });
        }
        {
            let self_obj = self.obj().clone();
            // After creating webrtcsink
            self_obj.connect_closure(
                "webrtcbin-ready",
                false,
                glib::closure!(move |signaller: &super::NestriSignaller,
                                     _consumer_identifier: &str,
                                     webrtcbin: &gst::Element| {
                    gst::info!(gst::CAT_DEFAULT, "Adding data channels");
                    // Create data channels on webrtcbin
                    let data_channel = Some(
                        webrtcbin.emit_by_name::<gst_webrtc::WebRTCDataChannel>(
                            "create-data-channel",
                            &[
                                &"nestri-data-channel",
                                &gst::Structure::builder("config")
                                    .field("ordered", &true)
                                    .field("max-retransmits", &2u32)
                                    .field("priority", "high")
                                    .field("protocol", "raw")
                                    .build(),
                            ],
                        ),
                    );
                    if let Some(data_channel) = data_channel {
                        gst::info!(gst::CAT_DEFAULT, "Data channel created");
                        if let Some(wayland_src) = signaller.imp().get_wayland_src() {
                            setup_data_channel(&data_channel, &*wayland_src);
                            signaller.imp().set_data_channel(data_channel);
                        } else {
                            gst::error!(gst::CAT_DEFAULT, "Wayland display source not set");
                        }
                    } else {
                        gst::error!(gst::CAT_DEFAULT, "Failed to create data channel");
                    }
                }),
            );
        }
    }
}
impl SignallableImpl for Signaller {
    fn start(&self) {
        gst::info!(gst::CAT_DEFAULT, "Signaller started");

        // Get WebSocket connection
        let nestri_ws = {
            self.nestri_ws
                .read()
                .clone()
                .expect("NestriWebSocket not set")
        };

        // Register message callbacks
        self.register_callbacks();

        // Subscribe to reconnection notifications
        let reconnected_notify = nestri_ws.subscribe_reconnected();

        // Clone necessary references
        let self_clone = self.obj().clone();
        let nestri_ws_clone = nestri_ws.clone();

        // Spawn a task to handle actions upon reconnection
        tokio::spawn(async move {
            loop {
                // Wait for a reconnection notification
                reconnected_notify.notified().await;

                tracing::warn!("Reconnected to relay, re-negotiating...");
                gst::warning!(gst::CAT_DEFAULT, "Reconnected to relay, re-negotiating...");

                // Emit "session-ended" first to make sure the element is cleaned up
                self_clone.emit_by_name::<bool>("session-ended", &[&"unique-session-id"]);

                // Send a new join message
                let join_msg = MessageJoin {
                    base: MessageBase {
                        payload_type: "join".to_string(),
                        latency: None,
                    },
                    joiner_type: JoinerType::JoinerNode,
                };
                if let Ok(encoded) = encode_message(&join_msg) {
                    if let Err(e) = nestri_ws_clone.send_message(encoded) {
                        gst::error!(
                            gst::CAT_DEFAULT,
                            "Failed to send join message after reconnection: {:?}",
                            e
                        );
                    }
                } else {
                    gst::error!(
                        gst::CAT_DEFAULT,
                        "Failed to encode join message after reconnection"
                    );
                }

                // If we need to interact with GStreamer or GLib, schedule it on the main thread
                let self_clone_for_main = self_clone.clone();
                glib::MainContext::default().invoke(move || {
                    // Emit the "session-requested" signal
                    self_clone_for_main.emit_by_name::<()>(
                        "session-requested",
                        &[
                            &"unique-session-id",
                            &"consumer-identifier",
                            &None::<WebRTCSessionDescription>,
                        ],
                    );
                });
            }
        });

        let join_msg = MessageJoin {
            base: MessageBase {
                payload_type: "join".to_string(),
                latency: None,
            },
            joiner_type: JoinerType::JoinerNode,
        };
        if let Ok(encoded) = encode_message(&join_msg) {
            if let Err(e) = nestri_ws.send_message(encoded) {
                tracing::error!("Failed to send join message: {:?}", e);
                gst::error!(gst::CAT_DEFAULT, "Failed to send join message: {:?}", e);
            }
        } else {
            gst::error!(gst::CAT_DEFAULT, "Failed to encode join message");
        }
    }

    fn stop(&self) {
        gst::info!(gst::CAT_DEFAULT, "Signaller stopped");
    }

    fn send_sdp(&self, _session_id: &str, sdp: &WebRTCSessionDescription) {
        let nestri_ws = {
            self.nestri_ws
                .read()
                .clone()
                .expect("NestriWebSocket not set")
        };
        let sdp_message = MessageSDP {
            base: MessageBase {
                payload_type: "sdp".to_string(),
                latency: None,
            },
            sdp: RTCSessionDescription::offer(sdp.sdp().as_text().unwrap()).unwrap(),
        };
        if let Ok(encoded) = encode_message(&sdp_message) {
            if let Err(e) = nestri_ws.send_message(encoded) {
                tracing::error!("Failed to send SDP message: {:?}", e);
                gst::error!(gst::CAT_DEFAULT, "Failed to send SDP message: {:?}", e);
            }
        } else {
            gst::error!(gst::CAT_DEFAULT, "Failed to encode SDP message");
        }
    }

    fn add_ice(
        &self,
        _session_id: &str,
        candidate: &str,
        sdp_m_line_index: u32,
        sdp_mid: Option<String>,
    ) {
        let nestri_ws = {
            self.nestri_ws
                .read()
                .clone()
                .expect("NestriWebSocket not set")
        };
        let candidate_init = RTCIceCandidateInit {
            candidate: candidate.to_string(),
            sdp_mid,
            sdp_mline_index: Some(sdp_m_line_index as u16),
            ..Default::default()
        };
        let ice_message = MessageICE {
            base: MessageBase {
                payload_type: "ice".to_string(),
                latency: None,
            },
            candidate: candidate_init,
        };
        if let Ok(encoded) = encode_message(&ice_message) {
            if let Err(e) = nestri_ws.send_message(encoded) {
                tracing::error!("Failed to send ICE message: {:?}", e);
                gst::error!(gst::CAT_DEFAULT, "Failed to send ICE message: {:?}", e);
            }
        } else {
            gst::error!(gst::CAT_DEFAULT, "Failed to encode ICE message");
        }
    }

    fn end_session(&self, session_id: &str) {
        gst::info!(gst::CAT_DEFAULT, "Ending session: {}", session_id);
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

fn setup_data_channel(data_channel: &gst_webrtc::WebRTCDataChannel, wayland_src: &gst::Element) {
    let wayland_src = wayland_src.clone();

    data_channel.connect_on_message_data(move |_data_channel, data| {
        if let Some(data) = data {
            match ProtoMessageInput::decode(data.to_vec().as_slice()) {
                Ok(message_input) => {
                    if let Some(input_msg) = message_input.data {
                        // Process the input message and create an event
                        if let Some(event) = handle_input_message(input_msg) {
                            // Send the event to wayland source, result bool is ignored
                            let _ = wayland_src.send_event(event);
                        }
                    } else {
                        tracing::error!("Failed to parse InputMessage");
                    }
                }
                Err(e) => {
                    tracing::error!("Failed to decode MessageInput: {:?}", e);
                }
            }
        }
    });
}

fn handle_input_message(input_msg: ProtoInput) -> Option<gst::Event> {
    if let Some(input_type) = input_msg.input_type {
        match input_type {
            MouseMove(data) => {
                let structure = gst::Structure::builder("MouseMoveRelative")
                    .field("pointer_x", data.x as f64)
                    .field("pointer_y", data.y as f64)
                    .build();

                Some(gst::event::CustomUpstream::new(structure))
            }
            MouseMoveAbs(data) => {
                let structure = gst::Structure::builder("MouseMoveAbsolute")
                    .field("pointer_x", data.x as f64)
                    .field("pointer_y", data.y as f64)
                    .build();

                Some(gst::event::CustomUpstream::new(structure))
            }
            KeyDown(data) => {
                let structure = gst::Structure::builder("KeyboardKey")
                    .field("key", data.key as u32)
                    .field("pressed", true)
                    .build();

                Some(gst::event::CustomUpstream::new(structure))
            }
            KeyUp(data) => {
                let structure = gst::Structure::builder("KeyboardKey")
                    .field("key", data.key as u32)
                    .field("pressed", false)
                    .build();

                Some(gst::event::CustomUpstream::new(structure))
            }
            MouseWheel(data) => {
                let structure = gst::Structure::builder("MouseAxis")
                    .field("x", data.x as f64)
                    .field("y", data.y as f64)
                    .build();

                Some(gst::event::CustomUpstream::new(structure))
            }
            MouseKeyDown(data) => {
                let structure = gst::Structure::builder("MouseButton")
                    .field("button", data.key as u32)
                    .field("pressed", true)
                    .build();

                Some(gst::event::CustomUpstream::new(structure))
            }
            MouseKeyUp(data) => {
                let structure = gst::Structure::builder("MouseButton")
                    .field("button", data.key as u32)
                    .field("pressed", false)
                    .build();

                Some(gst::event::CustomUpstream::new(structure))
            }
        }
    } else {
        None
    }
}
