use crate::proto::proto::ProtoControllerAttach;
use crate::proto::proto::proto_message::Payload;
use anyhow::Result;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::mpsc;

fn controller_string_to_type(controller_type: &str) -> Result<vimputti::DeviceConfig> {
    match controller_type.to_lowercase().as_str() {
        "ps4" => Ok(vimputti::ControllerTemplates::ps4()),
        "ps5" => Ok(vimputti::ControllerTemplates::ps5()),
        "xbox360" => Ok(vimputti::ControllerTemplates::xbox360()),
        "xboxone" => Ok(vimputti::ControllerTemplates::xbox_one()),
        "switchpro" => Ok(vimputti::ControllerTemplates::switch_pro()),
        _ => Err(anyhow::anyhow!(
            "Unsupported controller type: {}",
            controller_type
        )),
    }
}

pub struct ControllerInput {
    config: vimputti::DeviceConfig,
    device: vimputti::client::VirtualController,
}
impl ControllerInput {
    pub async fn new(
        controller_type: String,
        client: &vimputti::client::VimputtiClient,
    ) -> Result<Self> {
        let config = controller_string_to_type(&controller_type)?;
        let device = client.create_device(config.clone()).await?;
        Ok(Self { config, device })
    }

    pub fn device_mut(&mut self) -> &mut vimputti::client::VirtualController {
        &mut self.device
    }

    pub fn device(&self) -> &vimputti::client::VirtualController {
        &self.device
    }
}

pub struct ControllerManager {
    vimputti_client: Arc<vimputti::client::VimputtiClient>,
    cmd_tx: mpsc::Sender<Payload>,
    rumble_tx: mpsc::Sender<(u32, u16, u16, u16, String)>, // (slot, strong, weak, duration_ms, session_id)
    attach_tx: mpsc::Sender<ProtoControllerAttach>,
}
impl ControllerManager {
    pub fn new(
        vimputti_client: Arc<vimputti::client::VimputtiClient>,
    ) -> Result<(
        Self,
        mpsc::Receiver<(u32, u16, u16, u16, String)>,
        mpsc::Receiver<ProtoControllerAttach>,
    )> {
        let (cmd_tx, cmd_rx) = mpsc::channel(512);
        let (rumble_tx, rumble_rx) = mpsc::channel(256);
        let (attach_tx, attach_rx) = mpsc::channel(64);
        tokio::spawn(command_loop(
            cmd_rx,
            vimputti_client.clone(),
            rumble_tx.clone(),
            attach_tx.clone(),
        ));
        Ok((
            Self {
                vimputti_client,
                cmd_tx,
                rumble_tx,
                attach_tx,
            },
            rumble_rx,
            attach_rx,
        ))
    }

    pub async fn send_command(&self, payload: Payload) -> Result<()> {
        self.cmd_tx.send(payload).await?;
        Ok(())
    }
}

struct ControllerSlot {
    controller: ControllerInput,
    session_id: String,
    session_slot: u32,
}

// Returns first free controller slot from 0-16
fn get_free_slot(controllers: &HashMap<u32, ControllerSlot>) -> Option<u32> {
    for slot in 0..17 {
        if !controllers.contains_key(&slot) {
            return Some(slot);
        }
    }
    None
}

async fn command_loop(
    mut cmd_rx: mpsc::Receiver<Payload>,
    vimputti_client: Arc<vimputti::client::VimputtiClient>,
    rumble_tx: mpsc::Sender<(u32, u16, u16, u16, String)>,
    attach_tx: mpsc::Sender<ProtoControllerAttach>,
) {
    let mut controllers: HashMap<u32, ControllerSlot> = HashMap::new();
    while let Some(payload) = cmd_rx.recv().await {
        match payload {
            Payload::ControllerAttach(data) => {
                let session_id = data.session_id.clone();
                let session_slot = data.session_slot.clone();

                // Check if this session already has a slot (reconnection)
                let existing_slot = controllers
                    .iter()
                    .find(|(_, slot)| {
                        slot.session_id == session_id && slot.session_slot == session_slot as u32
                    })
                    .map(|(slot_num, _)| *slot_num);

                if let Some(existing_slot) = existing_slot {
                    if let Some(controller_slot) = controllers.get_mut(&existing_slot) {
                        let rumble_tx = rumble_tx.clone();
                        let attach_tx = attach_tx.clone();

                        controller_slot
                            .controller
                            .device_mut()
                            .on_rumble(move |strong, weak, duration_ms| {
                                let _ = rumble_tx.try_send((
                                    existing_slot,
                                    strong,
                                    weak,
                                    duration_ms,
                                    data.session_id.clone(),
                                ));
                            })
                            .await
                            .map_err(|e| {
                                tracing::warn!(
                                    "Failed to register rumble callback for slot {}: {}",
                                    existing_slot,
                                    e
                                );
                            })
                            .ok();

                        // Return to attach_tx what slot was assigned
                        let attach_info = ProtoControllerAttach {
                            id: data.id.clone(),
                            session_slot: existing_slot as i32,
                            session_id: session_id.clone(),
                        };

                        match attach_tx.send(attach_info).await {
                            Ok(_) => {
                                tracing::info!(
                                    "Controller {} re-attached to slot {} (session: {})",
                                    data.id,
                                    existing_slot,
                                    session_id
                                );
                            }
                            Err(e) => {
                                tracing::error!(
                                    "Failed to send re-attach info for slot {}: {}",
                                    existing_slot,
                                    e
                                );
                            }
                        }
                    }
                } else if let Some(slot) = get_free_slot(&controllers) {
                    if let Ok(mut controller) =
                        ControllerInput::new(data.id.clone(), &vimputti_client).await
                    {
                        let rumble_tx = rumble_tx.clone();
                        let attach_tx = attach_tx.clone();

                        controller
                            .device_mut()
                            .on_rumble(move |strong, weak, duration_ms| {
                                let _ = rumble_tx.try_send((
                                    slot,
                                    strong,
                                    weak,
                                    duration_ms,
                                    data.session_id.clone(),
                                ));
                            })
                            .await
                            .map_err(|e| {
                                tracing::warn!(
                                    "Failed to register rumble callback for slot {}: {}",
                                    slot,
                                    e
                                );
                            })
                            .ok();

                        // Return to attach_tx what slot was assigned
                        let attach_info = ProtoControllerAttach {
                            id: data.id.clone(),
                            session_slot: slot as i32,
                            session_id: session_id.clone(),
                        };

                        match attach_tx.send(attach_info).await {
                            Ok(_) => {
                                controllers.insert(
                                    slot,
                                    ControllerSlot {
                                        controller,
                                        session_id: session_id.clone(),
                                        session_slot: session_slot.clone() as u32,
                                    },
                                );
                                tracing::info!(
                                    "Controller {} attached to slot {} (session: {})",
                                    data.id,
                                    slot,
                                    session_id
                                );
                            }
                            Err(e) => {
                                tracing::error!(
                                    "Failed to send attach info for slot {}: {}",
                                    slot,
                                    e
                                );
                            }
                        }
                    } else {
                        tracing::error!(
                            "Failed to create controller of type {} for slot {}",
                            data.id,
                            slot
                        );
                    }
                }
            }
            Payload::ControllerDetach(data) => {
                if controllers.remove(&(data.session_slot as u32)).is_some() {
                    tracing::info!("Controller detached from slot {}", data.session_slot);
                } else {
                    tracing::warn!(
                        "No controller found in slot {} to detach",
                        data.session_slot
                    );
                }
            }
            Payload::ClientDisconnected(data) => {
                tracing::info!(
                    "Client disconnected, cleaning up controller slots: {:?} (client session: {})",
                    data.controller_slots,
                    data.session_id
                );
                // Remove all controllers for the disconnected slots
                for slot in &data.controller_slots {
                    if controllers.remove(&(*slot as u32)).is_some() {
                        tracing::info!(
                            "Removed controller from slot {} (client session: {})",
                            slot,
                            data.session_id
                        );
                    } else {
                        tracing::warn!(
                            "No controller found in slot {} to cleanup (client session: {})",
                            slot,
                            data.session_id
                        );
                    }
                }
            }
            Payload::ControllerStateBatch(data) => {
                if let Some(controller) = controllers.get(&(data.session_slot as u32)) {
                    let device = controller.controller.device();

                    // Handle inputs based on update type
                    if data.update_type == 0 {
                        // FULL_STATE: Update all values
                        let _ = device.sync().await;
                        for (btn_code, pressed) in data.button_changed_mask {
                            if let Some(button) = vimputti::Button::from_ev_code(btn_code as u16) {
                                let _ = device.button(button, pressed).await;
                                let _ = device.sync().await;
                            }
                        }
                        if let Some(x) = data.left_stick_x {
                            let _ = device.axis(vimputti::Axis::LeftStickX, x).await;
                            let _ = device.sync().await;
                        }
                        if let Some(y) = data.left_stick_y {
                            let _ = device.axis(vimputti::Axis::LeftStickY, y).await;
                            let _ = device.sync().await;
                        }
                        if let Some(x) = data.right_stick_x {
                            let _ = device.axis(vimputti::Axis::RightStickX, x).await;
                            let _ = device.sync().await;
                        }
                        if let Some(y) = data.right_stick_y {
                            let _ = device.axis(vimputti::Axis::RightStickY, y).await;
                            let _ = device.sync().await;
                        }
                        if let Some(value) = data.left_trigger {
                            let _ = device.axis(vimputti::Axis::LowerLeftTrigger, value).await;
                            let _ = device.sync().await;
                        }
                        if let Some(value) = data.right_trigger {
                            let _ = device.axis(vimputti::Axis::LowerRightTrigger, value).await;
                            let _ = device.sync().await;
                        }
                        if let Some(x) = data.dpad_x {
                            let _ = device.axis(vimputti::Axis::DPadX, x).await;
                            let _ = device.sync().await;
                        }
                        if let Some(y) = data.dpad_y {
                            let _ = device.axis(vimputti::Axis::DPadY, y).await;
                            let _ = device.sync().await;
                        }
                    } else {
                        // DELTA: Only update changed values
                        if let Some(changed_fields) = data.changed_fields {
                            let _ = device.sync().await;
                            if (changed_fields & (1 << 0)) != 0 {
                                for (btn_code, pressed) in data.button_changed_mask {
                                    if let Some(button) =
                                        vimputti::Button::from_ev_code(btn_code as u16)
                                    {
                                        let _ = device.button(button, pressed).await;
                                        let _ = device.sync().await;
                                    }
                                }
                            }
                            if (changed_fields & (1 << 1)) != 0 {
                                if let Some(x) = data.left_stick_x {
                                    let _ = device.axis(vimputti::Axis::LeftStickX, x).await;
                                    let _ = device.sync().await;
                                }
                            }
                            if (changed_fields & (1 << 2)) != 0 {
                                if let Some(y) = data.left_stick_y {
                                    let _ = device.axis(vimputti::Axis::LeftStickY, y).await;
                                    let _ = device.sync().await;
                                }
                            }
                            if (changed_fields & (1 << 3)) != 0 {
                                if let Some(x) = data.right_stick_x {
                                    let _ = device.axis(vimputti::Axis::RightStickX, x).await;
                                    let _ = device.sync().await;
                                }
                            }
                            if (changed_fields & (1 << 4)) != 0 {
                                if let Some(y) = data.right_stick_y {
                                    let _ = device.axis(vimputti::Axis::RightStickY, y).await;
                                    let _ = device.sync().await;
                                }
                            }
                            if (changed_fields & (1 << 5)) != 0 {
                                if let Some(value) = data.left_trigger {
                                    let _ =
                                        device.axis(vimputti::Axis::LowerLeftTrigger, value).await;
                                    let _ = device.sync().await;
                                }
                            }
                            if (changed_fields & (1 << 6)) != 0 {
                                if let Some(value) = data.right_trigger {
                                    let _ =
                                        device.axis(vimputti::Axis::LowerRightTrigger, value).await;
                                    let _ = device.sync().await;
                                }
                            }
                            if (changed_fields & (1 << 7)) != 0 {
                                if let Some(x) = data.dpad_x {
                                    let _ = device.axis(vimputti::Axis::DPadX, x).await;
                                    let _ = device.sync().await;
                                }
                            }
                            if (changed_fields & (1 << 8)) != 0 {
                                if let Some(y) = data.dpad_y {
                                    let _ = device.axis(vimputti::Axis::DPadY, y).await;
                                    let _ = device.sync().await;
                                }
                            }
                        }
                    }
                } else {
                    tracing::warn!(
                        "Controller slot {} not found for state batch event",
                        data.session_slot
                    );
                }
            }
            _ => {
                //no-op
            }
        }
    }
}
