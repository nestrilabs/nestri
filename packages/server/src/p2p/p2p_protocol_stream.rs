use crate::p2p::p2p::NestriConnection;
use crate::p2p::p2p_safestream::SafeStream;
use anyhow::Result;
use dashmap::DashMap;
use libp2p::StreamProtocol;
use std::sync::Arc;
use tokio::sync::mpsc;

// Cloneable callback type
pub type CallbackInner = dyn Fn(Vec<u8>) -> Result<()> + Send + Sync + 'static;
pub struct Callback(Arc<CallbackInner>);
impl Callback {
    pub fn new<F>(f: F) -> Self
    where
        F: Fn(Vec<u8>) -> Result<()> + Send + Sync + 'static,
    {
        Callback(Arc::new(f))
    }

    pub fn call(&self, data: Vec<u8>) -> Result<()> {
        self.0(data)
    }
}
impl Clone for Callback {
    fn clone(&self) -> Self {
        Callback(Arc::clone(&self.0))
    }
}
impl From<Box<CallbackInner>> for Callback {
    fn from(boxed: Box<CallbackInner>) -> Self {
        Callback(Arc::from(boxed))
    }
}

/// NestriStreamProtocol manages the stream protocol for Nestri connections.
pub struct NestriStreamProtocol {
    tx: Option<mpsc::Sender<Vec<u8>>>,
    safe_stream: Arc<SafeStream>,
    callbacks: Arc<DashMap<String, Callback>>,
    read_handle: Option<tokio::task::JoinHandle<()>>,
    write_handle: Option<tokio::task::JoinHandle<()>>,
}
impl NestriStreamProtocol {
    const NESTRI_PROTOCOL_STREAM_PUSH: StreamProtocol =
        StreamProtocol::new("/nestri-relay/stream-push/1.0.0");

    pub async fn new(nestri_connection: NestriConnection) -> Result<Self> {
        let mut nestri_connection = nestri_connection.clone();
        let push_stream = match nestri_connection
            .control
            .open_stream(nestri_connection.peer_id, Self::NESTRI_PROTOCOL_STREAM_PUSH)
            .await
        {
            Ok(stream) => stream,
            Err(e) => {
                return Err(anyhow::Error::msg(format!(
                    "Failed to open push stream: {}",
                    e
                )));
            }
        };

        let mut sp = NestriStreamProtocol {
            tx: None,
            safe_stream: Arc::new(SafeStream::new(push_stream)),
            callbacks: Arc::new(DashMap::new()),
            read_handle: None,
            write_handle: None,
        };

        // Use restart method to initialize the read and write loops
        sp.restart()?;

        Ok(sp)
    }

    pub fn restart(&mut self) -> Result<()> {
        // Return if tx and handles are already initialized
        if self.tx.is_some() && self.read_handle.is_some() && self.write_handle.is_some() {
            tracing::warn!("NestriStreamProtocol is already running, restart skipped");
            return Ok(());
        }

        let (tx, rx) = mpsc::channel(1000);
        self.tx = Some(tx);
        self.read_handle = Some(self.spawn_read_loop());
        self.write_handle = Some(self.spawn_write_loop(rx));

        Ok(())
    }

    fn spawn_read_loop(&self) -> tokio::task::JoinHandle<()> {
        let safe_stream = self.safe_stream.clone();
        let callbacks = self.callbacks.clone();
        tokio::spawn(async move {
            loop {
                let data = {
                    match safe_stream.receive_raw().await {
                        Ok(data) => data,
                        Err(e) => {
                            tracing::error!("Error receiving data: {}", e);
                            break; // Exit the loop on error
                        }
                    }
                };

                match serde_json::from_slice::<crate::messages::MessageBase>(&data) {
                    Ok(base_message) => {
                        let response_type = base_message.payload_type;

                        // With DashMap, we don't need explicit locking
                        // we just get the callback directly if it exists
                        if let Some(callback) = callbacks.get(&response_type) {
                            // Execute the callback
                            if let Err(e) = callback.call(data.clone()) {
                                tracing::error!(
                                    "Callback for response type '{}' errored: {:?}",
                                    response_type,
                                    e
                                );
                            }
                        } else {
                            tracing::warn!(
                                "No callback registered for response type: {}",
                                response_type
                            );
                        }
                    }
                    Err(e) => {
                        tracing::error!("Failed to decode message: {}", e);
                    }
                }
            }
        })
    }

    fn spawn_write_loop(&self, mut rx: mpsc::Receiver<Vec<u8>>) -> tokio::task::JoinHandle<()> {
        let safe_stream = self.safe_stream.clone();
        tokio::spawn(async move {
            loop {
                // Wait for a message from the channel
                match rx.recv().await {
                    Some(tx_data) => {
                        if let Err(e) = safe_stream.send_raw(&tx_data).await {
                            tracing::error!("Error sending data: {:?}", e);
                        }
                    }
                    None => {
                        tracing::info!("Receiver closed, exiting write loop");
                        break;
                    }
                }
            }
        })
    }

    pub fn send_message<M: serde::Serialize>(&self, message: &M) -> Result<()> {
        let json_data = serde_json::to_vec(message)?;
        let Some(tx) = &self.tx else {
            return Err(anyhow::Error::msg(
                if self.read_handle.is_none() && self.write_handle.is_none() {
                    "NestriStreamProtocol has been shutdown"
                } else {
                    "NestriStreamProtocol is not properly initialized"
                },
            ));
        };
        tx.try_send(json_data)?;
        Ok(())
    }

    pub fn register_callback<F>(&self, response_type: &str, callback: F)
    where
        F: Fn(Vec<u8>) -> Result<()> + Send + Sync + 'static,
    {
        self.callbacks
            .insert(response_type.to_string(), Callback::new(callback));
    }
}
