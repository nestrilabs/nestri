use crate::p2p::p2p::NestriConnection;
use crate::p2p::p2p_safestream::SafeStream;
use libp2p::StreamProtocol;
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use tokio::sync::mpsc;

// Cloneable callback type
pub type CallbackInner = dyn Fn(Vec<u8>) + Send + Sync + 'static;
pub struct Callback(Arc<CallbackInner>);
impl Callback {
    pub fn new<F>(f: F) -> Self
    where
        F: Fn(Vec<u8>) + Send + Sync + 'static,
    {
        Callback(Arc::new(f))
    }

    pub fn call(&self, data: Vec<u8>) {
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
    tx: mpsc::Sender<Vec<u8>>,
    safe_stream: Arc<SafeStream>,
    callbacks: Arc<RwLock<HashMap<String, Callback>>>,
}
impl NestriStreamProtocol {
    const NESTRI_PROTOCOL_STREAM_PUSH: StreamProtocol =
        StreamProtocol::new("/nestri-relay/stream-push/1.0.0");

    pub async fn new(
        nestri_connection: NestriConnection,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let mut nestri_connection = nestri_connection.clone();
        let push_stream = match nestri_connection
            .control
            .open_stream(nestri_connection.peer_id, Self::NESTRI_PROTOCOL_STREAM_PUSH)
            .await
        {
            Ok(stream) => stream,
            Err(e) => {
                return Err(Box::new(e));
            }
        };

        let (tx, rx) = mpsc::channel(1000);

        let sp = NestriStreamProtocol {
            tx,
            safe_stream: Arc::new(SafeStream::new(push_stream)),
            callbacks: Arc::new(RwLock::new(HashMap::new())),
        };

        // Spawn the loops
        sp.spawn_read_loop();
        sp.spawn_write_loop(rx);

        Ok(sp)
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
                        let callback = {
                            let callbacks_lock = callbacks.read().unwrap();
                            callbacks_lock.get(&response_type).cloned()
                        };

                        if let Some(callback) = callback {
                            // Call the registered callback with the raw data
                            callback.call(data);
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
                if let Some(tx_data) = rx.recv().await {
                    if let Err(e) = safe_stream.send_raw(&tx_data).await {
                        tracing::error!("Error sending data: {:?}", e);
                    }
                } else {
                    tracing::info!("Receiver closed, exiting write loop");
                    break;
                }
            }
        })
    }

    pub fn send_message<M: serde::Serialize>(
        &self,
        message: &M,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let json_data = serde_json::to_vec(message)?;
        self.tx.try_send(json_data)?;
        Ok(())
    }

    /// Register a callback for a specific response type
    pub fn register_callback<F>(&self, response_type: &str, callback: F)
    where
        F: Fn(Vec<u8>) + Send + Sync + 'static,
    {
        let mut callbacks_lock = self.callbacks.write().unwrap();
        callbacks_lock.insert(response_type.to_string(), Callback::new(callback));
    }
}
