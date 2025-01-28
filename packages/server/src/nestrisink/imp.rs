use crate::messages::{
    decode_message_as, encode_message, AnswerType, InputMessage, JoinerType, MessageAnswer,
    MessageBase, MessageICE, MessageInput, MessageJoin, MessageSDP,
};
use crate::websocket::NestriWebSocket;
use glib::subclass::prelude::*;
use gst::glib;
use gst::prelude::*;
use gst_webrtc::{gst_sdp, WebRTCSDPType, WebRTCSessionDescription};
use gstrswebrtc::signaller::{Signallable, SignallableImpl};
use std::collections::HashSet;
use std::sync::{Arc, LazyLock};
use std::sync::{Mutex, RwLock};
use webrtc::ice_transport::ice_candidate::RTCIceCandidateInit;
use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;

pub struct Signaller {
    nestri_ws: RwLock<Option<Arc<NestriWebSocket>>>,
    pipeline: RwLock<Option<Arc<gst::Pipeline>>>,
    data_channel: RwLock<Option<gst_webrtc::WebRTCDataChannel>>,
}
impl Default for Signaller {
    fn default() -> Self {
        Self {
            nestri_ws: RwLock::new(None),
            pipeline: RwLock::new(None),
            data_channel: RwLock::new(None),
        }
    }
}
impl Signaller {
    pub fn set_nestri_ws(&self, nestri_ws: Arc<NestriWebSocket>) {
        *self.nestri_ws.write().unwrap() = Some(nestri_ws);
    }

    pub fn set_pipeline(&self, pipeline: Arc<gst::Pipeline>) {
        *self.pipeline.write().unwrap() = Some(pipeline);
    }

    pub fn get_pipeline(&self) -> Option<Arc<gst::Pipeline>> {
        self.pipeline.read().unwrap().clone()
    }

    pub fn set_data_channel(&self, data_channel: gst_webrtc::WebRTCDataChannel) {
        *self.data_channel.write().unwrap() = Some(data_channel);
    }

    /// Helper method to clean things up
    fn register_callbacks(&self) {
        let nestri_ws = {
            self.nestri_ws
                .read()
                .unwrap()
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
                                    .field("ordered", &false)
                                    .field("max-retransmits", &0u32)
                                    .build(),
                            ],
                        ),
                    );
                    if let Some(data_channel) = data_channel {
                        gst::info!(gst::CAT_DEFAULT, "Data channel created");
                        if let Some(pipeline) = signaller.imp().get_pipeline() {
                            setup_data_channel(&data_channel, &pipeline);
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
                .unwrap()
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

                println!("Reconnected to relay, re-negotiating...");
                gst::warning!(gst::CAT_DEFAULT, "Reconnected to relay, re-negotiating...");

                // Emit "session-ended" first to make sure the element is cleaned up
                self_clone.emit_by_name::<bool>("session-ended", &[&"unique-session-id"]);

                // Send a new join message
                let join_msg = MessageJoin {
                    base: MessageBase {
                        payload_type: "join".to_string(),
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
            },
            joiner_type: JoinerType::JoinerNode,
        };
        if let Ok(encoded) = encode_message(&join_msg) {
            if let Err(e) = nestri_ws.send_message(encoded) {
                eprintln!("Failed to send join message: {:?}", e);
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
                .unwrap()
                .clone()
                .expect("NestriWebSocket not set")
        };
        let sdp_message = MessageSDP {
            base: MessageBase {
                payload_type: "sdp".to_string(),
            },
            sdp: RTCSessionDescription::offer(sdp.sdp().as_text().unwrap()).unwrap(),
        };
        if let Ok(encoded) = encode_message(&sdp_message) {
            if let Err(e) = nestri_ws.send_message(encoded) {
                eprintln!("Failed to send SDP message: {:?}", e);
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
                .unwrap()
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
            },
            candidate: candidate_init,
        };
        if let Ok(encoded) = encode_message(&ice_message) {
            if let Err(e) = nestri_ws.send_message(encoded) {
                eprintln!("Failed to send ICE message: {:?}", e);
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
            vec![glib::ParamSpecBoolean::builder("manual-sdp-munging")
                .nick("Manual SDP munging")
                .blurb("Whether the signaller manages SDP munging itself")
                .default_value(false)
                .read_only()
                .build()]
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

fn setup_data_channel(data_channel: &gst_webrtc::WebRTCDataChannel, pipeline: &gst::Pipeline) {
    let pipeline = pipeline.clone();
    // A shared state to track currently pressed keys
    let pressed_keys = Arc::new(Mutex::new(HashSet::new()));
    let pressed_buttons = Arc::new(Mutex::new(HashSet::new()));

    data_channel.connect_on_message_data(move |_data_channel, data| {
        if let Some(data) = data {
            match decode_message_as::<MessageInput>(data.to_vec()) {
                Ok(message_input) => {
                    // Deserialize the input message data
                    if let Ok(input_msg) = serde_json::from_str::<InputMessage>(&message_input.data)
                    {
                        // Process the input message and create an event
                        if let Some(event) =
                            handle_input_message(input_msg, &pressed_keys, &pressed_buttons)
                        {
                            // Send the event to pipeline, result bool is ignored
                            let _ = pipeline.send_event(event);
                        }
                    } else {
                        eprintln!("Failed to parse InputMessage");
                    }
                }
                Err(e) => {
                    eprintln!("Failed to decode MessageInput: {:?}", e);
                }
            }
        }
    });
}

fn handle_input_message(
    input_msg: InputMessage,
    pressed_keys: &Arc<Mutex<HashSet<i32>>>,
    pressed_buttons: &Arc<Mutex<HashSet<i32>>>,
) -> Option<gst::Event> {
    match input_msg {
        InputMessage::MouseMove { x, y } => {
            let structure = gst::Structure::builder("MouseMoveRelative")
                .field("pointer_x", x as f64)
                .field("pointer_y", y as f64)
                .build();

            Some(gst::event::CustomUpstream::new(structure))
        }
        InputMessage::MouseMoveAbs { x, y } => {
            let structure = gst::Structure::builder("MouseMoveAbsolute")
                .field("pointer_x", x as f64)
                .field("pointer_y", y as f64)
                .build();

            Some(gst::event::CustomUpstream::new(structure))
        }
        InputMessage::KeyDown { key } => {
            let mut keys = pressed_keys.lock().unwrap();
            // If the key is already pressed, return to prevent key lockup
            if keys.contains(&key) {
                return None;
            }
            keys.insert(key);

            let structure = gst::Structure::builder("KeyboardKey")
                .field("key", key as u32)
                .field("pressed", true)
                .build();

            Some(gst::event::CustomUpstream::new(structure))
        }
        InputMessage::KeyUp { key } => {
            let mut keys = pressed_keys.lock().unwrap();
            // Remove the key from the pressed state when released
            keys.remove(&key);

            let structure = gst::Structure::builder("KeyboardKey")
                .field("key", key as u32)
                .field("pressed", false)
                .build();

            Some(gst::event::CustomUpstream::new(structure))
        }
        InputMessage::Wheel { x, y } => {
            let structure = gst::Structure::builder("MouseAxis")
                .field("x", x as f64)
                .field("y", y as f64)
                .build();

            Some(gst::event::CustomUpstream::new(structure))
        }
        InputMessage::MouseDown { key } => {
            let mut buttons = pressed_buttons.lock().unwrap();
            // If the button is already pressed, return to prevent button lockup
            if buttons.contains(&key) {
                return None;
            }
            buttons.insert(key);

            let structure = gst::Structure::builder("MouseButton")
                .field("button", key as u32)
                .field("pressed", true)
                .build();

            Some(gst::event::CustomUpstream::new(structure))
        }
        InputMessage::MouseUp { key } => {
            let mut buttons = pressed_buttons.lock().unwrap();
            // Remove the button from the pressed state when released
            buttons.remove(&key);

            let structure = gst::Structure::builder("MouseButton")
                .field("button", key as u32)
                .field("pressed", false)
                .build();

            Some(gst::event::CustomUpstream::new(structure))
        }
    }
}
