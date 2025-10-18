use crate::proto::proto::proto_input::InputType::{
    ControllerAttach, ControllerAxis, ControllerButton, ControllerDetach, ControllerRumble,
    ControllerStick, ControllerTrigger,
};
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
        Ok(Self {
            config: config.clone(),
            device: client.create_device(config).await?,
        })
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
    cmd_tx: mpsc::Sender<crate::proto::proto::ProtoInput>,
    rumble_tx: mpsc::Sender<(u32, u16, u16, u16)>, // (slot, strong, weak, duration_ms)
}
impl ControllerManager {
    pub fn new(
        vimputti_client: Arc<vimputti::client::VimputtiClient>,
    ) -> Result<(Self, mpsc::Receiver<(u32, u16, u16, u16)>)> {
        let (cmd_tx, cmd_rx) = mpsc::channel(100);
        let (rumble_tx, rumble_rx) = mpsc::channel(100);
        tokio::spawn(command_loop(
            cmd_rx,
            vimputti_client.clone(),
            rumble_tx.clone(),
        ));
        Ok((
            Self {
                vimputti_client,
                cmd_tx,
                rumble_tx,
            },
            rumble_rx,
        ))
    }

    pub async fn send_command(&self, input: crate::proto::proto::ProtoInput) -> Result<()> {
        self.cmd_tx.send(input).await?;
        Ok(())
    }
}

async fn command_loop(
    mut cmd_rx: mpsc::Receiver<crate::proto::proto::ProtoInput>,
    vimputti_client: Arc<vimputti::client::VimputtiClient>,
    rumble_tx: mpsc::Sender<(u32, u16, u16, u16)>,
) {
    let mut controllers: HashMap<u32, ControllerInput> = HashMap::new();
    while let Some(input) = cmd_rx.recv().await {
        if let Some(input_type) = input.input_type {
            match input_type {
                ControllerAttach(data) => {
                    // Check if controller already exists in the slot, if so, ignore
                    if controllers.contains_key(&(data.slot as u32)) {
                        tracing::warn!(
                            "Controller slot {} already occupied, ignoring attach",
                            data.slot
                        );
                    } else {
                        if let Ok(mut controller) =
                            ControllerInput::new(data.id.clone(), &vimputti_client).await
                        {
                            let slot = data.slot as u32;
                            let rumble_tx = rumble_tx.clone();

                            controller
                                .device_mut()
                                .on_rumble(move |strong, weak, duration_ms| {
                                    let _ = rumble_tx.try_send((slot, strong, weak, duration_ms));
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

                            controllers.insert(data.slot as u32, controller);
                            tracing::info!("Controller {} attached to slot {}", data.id, data.slot);
                        } else {
                            tracing::error!(
                                "Failed to create controller of type {} for slot {}",
                                data.id,
                                data.slot
                            );
                        }
                    }
                }
                ControllerDetach(data) => {
                    if controllers.remove(&(data.slot as u32)).is_some() {
                        tracing::info!("Controller detached from slot {}", data.slot);
                    } else {
                        tracing::warn!("No controller found in slot {} to detach", data.slot);
                    }
                }
                ControllerButton(data) => {
                    if let Some(controller) = controllers.get(&(data.slot as u32)) {
                        if let Some(button) = vimputti::Button::from_ev_code(data.button as u16) {
                            let device = controller.device();
                            device.button(button, data.pressed);
                            device.sync();
                        }
                    } else {
                        tracing::warn!("Controller slot {} not found for button event", data.slot);
                    }
                }
                ControllerStick(data) => {
                    if let Some(controller) = controllers.get(&(data.slot as u32)) {
                        let device = controller.device();
                        if data.stick == 0 {
                            // Left stick
                            device.axis(vimputti::Axis::LeftStickX, data.x);
                            device.sync();
                            device.axis(vimputti::Axis::LeftStickY, data.y);
                        } else if data.stick == 1 {
                            // Right stick
                            device.axis(vimputti::Axis::RightStickX, data.x);
                            device.sync();
                            device.axis(vimputti::Axis::RightStickY, data.y);
                        }
                        device.sync();
                    } else {
                        tracing::warn!("Controller slot {} not found for stick event", data.slot);
                    }
                }
                ControllerTrigger(data) => {
                    if let Some(controller) = controllers.get(&(data.slot as u32)) {
                        let device = controller.device();
                        if data.trigger == 0 {
                            // Left trigger
                            device.axis(vimputti::Axis::LowerLeftTrigger, data.value);
                        } else if data.trigger == 1 {
                            // Right trigger
                            device.axis(vimputti::Axis::LowerRightTrigger, data.value);
                        }
                        device.sync();
                    } else {
                        tracing::warn!("Controller slot {} not found for trigger event", data.slot);
                    }
                }
                ControllerAxis(data) => {
                    if let Some(controller) = controllers.get(&(data.slot as u32)) {
                        let device = controller.device();
                        if data.axis == 0 {
                            // dpad x
                            device.axis(vimputti::Axis::DPadX, data.value);
                        } else if data.axis == 1 {
                            // dpad y
                            device.axis(vimputti::Axis::DPadY, data.value);
                        }
                        device.sync();
                    }
                }
                // Rumble will be outgoing event..
                ControllerRumble(_) => {
                    //no-op
                }
                _ => {
                    //no-op
                }
            }
        }
    }
}
