use crate::messages::{decode_message, encode_message, MessageBase, MessageLog};
use futures_util::sink::SinkExt;
use futures_util::stream::{SplitSink, SplitStream};
use futures_util::StreamExt;
use log::{Level, Log, Metadata, Record};
use std::collections::HashMap;
use std::error::Error;
use std::sync::{Arc, RwLock};
use std::time::Duration;
use tokio::net::TcpStream;
use tokio::sync::{mpsc, Mutex, Notify};
use tokio::time::sleep;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

type Callback = Box<dyn Fn(Vec<u8>) + Send + Sync>;
type WSRead = SplitStream<WebSocketStream<MaybeTlsStream<TcpStream>>>;
type WSWrite = SplitSink<WebSocketStream<MaybeTlsStream<TcpStream>>, Message>;

#[derive(Clone)]
pub struct NestriWebSocket {
    ws_url: String,
    reader: Arc<Mutex<Option<WSRead>>>,
    writer: Arc<Mutex<Option<WSWrite>>>,
    callbacks: Arc<RwLock<HashMap<String, Callback>>>,
    message_tx: mpsc::UnboundedSender<Vec<u8>>,
    reconnected_notify: Arc<Notify>,
}
impl NestriWebSocket {
    pub async fn new(ws_url: String) -> Result<NestriWebSocket, Box<dyn Error>> {
        // Attempt to connect to the WebSocket
        let ws_stream = NestriWebSocket::do_connect(&ws_url).await.unwrap();

        // Split the stream into read and write halves
        let (write, read) = ws_stream.split();

        // Create the message channel
        let (message_tx, message_rx) = mpsc::unbounded_channel();

        let ws = NestriWebSocket {
            ws_url,
            reader: Arc::new(Mutex::new(Some(read))),
            writer: Arc::new(Mutex::new(Some(write))),
            callbacks: Arc::new(RwLock::new(HashMap::new())),
            message_tx: message_tx.clone(),
            reconnected_notify: Arc::new(Notify::new()),
        };

        // Spawn the read loop
        ws.spawn_read_loop();
        // Spawn the write loop
        ws.spawn_write_loop(message_rx);

        Ok(ws)
    }

    async fn do_connect(
        ws_url: &str,
    ) -> Result<WebSocketStream<MaybeTlsStream<TcpStream>>, Box<dyn Error + Send + Sync>> {
        loop {
            match connect_async(ws_url).await {
                Ok((ws_stream, _)) => {
                    return Ok(ws_stream);
                }
                Err(e) => {
                    eprintln!("Failed to connect to WebSocket, retrying: {:?}", e);
                    sleep(Duration::from_secs(3)).await; // Wait before retrying
                }
            }
        }
    }

    // Handles message -> callback calls and reconnects on error/disconnect
    fn spawn_read_loop(&self) {
        let reader = self.reader.clone();
        let callbacks = self.callbacks.clone();
        let self_clone = self.clone();

        tokio::spawn(async move {
            loop {
                // Lock the reader to get the WSRead, then drop the lock
                let ws_read_option = {
                    let mut reader_lock = reader.lock().await;
                    reader_lock.take()
                };

                let mut ws_read = match ws_read_option {
                    Some(ws_read) => ws_read,
                    None => {
                        eprintln!("Reader is None, cannot proceed");
                        return;
                    }
                };

                while let Some(message_result) = ws_read.next().await {
                    match message_result {
                        Ok(message) => {
                            let data = message.into_data();
                            let base_message = match decode_message(&data) {
                                Ok(base_message) => base_message,
                                Err(e) => {
                                    eprintln!("Failed to decode message: {:?}", e);
                                    continue;
                                }
                            };

                            let callbacks_lock = callbacks.read().unwrap();
                            if let Some(callback) = callbacks_lock.get(&base_message.payload_type) {
                                let data = data.clone();
                                callback(data);
                            }
                        }
                        Err(e) => {
                            eprintln!("Error receiving message: {:?}, reconnecting in 3 seconds...", e);
                            sleep(Duration::from_secs(3)).await;
                            self_clone.reconnect().await.unwrap();
                            break; // Break the inner loop to get a new ws_read
                        }
                    }
                }
                // After reconnection, the loop continues, and we acquire a new ws_read
            }
        });
    }

    fn spawn_write_loop(&self, mut message_rx: mpsc::UnboundedReceiver<Vec<u8>>) {
        let writer = self.writer.clone();
        let self_clone = self.clone();

        tokio::spawn(async move {
            loop {
                // Wait for a message from the channel
                if let Some(message) = message_rx.recv().await {
                    loop {
                        // Acquire the writer lock
                        let mut writer_lock = writer.lock().await;
                        if let Some(writer) = writer_lock.as_mut() {
                            // Try to send the message over the WebSocket
                            match writer.send(Message::Binary(message.clone())).await {
                                Ok(_) => {
                                    // Message sent successfully
                                    break;
                                }
                                Err(e) => {
                                    eprintln!("Error sending message: {:?}", e);
                                    // Attempt to reconnect
                                    if let Err(e) = self_clone.reconnect().await {
                                        eprintln!("Error during reconnection: {:?}", e);
                                        // Wait before retrying
                                        sleep(Duration::from_secs(3)).await;
                                        continue;
                                    }
                                }
                            }
                        } else {
                            eprintln!("Writer is None, cannot send message");
                            // Attempt to reconnect
                            if let Err(e) = self_clone.reconnect().await {
                                eprintln!("Error during reconnection: {:?}", e);
                                // Wait before retrying
                                sleep(Duration::from_secs(3)).await;
                                continue;
                            }
                        }
                    }
                } else {
                    break;
                }
            }
        });
    }

    async fn reconnect(&self) -> Result<(), Box<dyn Error + Send + Sync>> {
        loop {
            match NestriWebSocket::do_connect(&self.ws_url).await {
                Ok(ws_stream) => {
                    let (write, read) = ws_stream.split();
                    {
                        let mut writer_lock = self.writer.lock().await;
                        *writer_lock = Some(write);
                    }
                    {
                        let mut reader_lock = self.reader.lock().await;
                        *reader_lock = Some(read);
                    }
                    // Notify subscribers of successful reconnection
                    self.reconnected_notify.notify_waiters();
                    return Ok(());
                }
                Err(e) => {
                    eprintln!("Failed to reconnect to WebSocket: {:?}", e);
                    sleep(Duration::from_secs(3)).await; // Wait before retrying
                }
            }
        }
    }

    /// Send a message through the WebSocket
    pub fn send_message(&self, message: Vec<u8>) -> Result<(), Box<dyn Error>> {
        self.message_tx
            .send(message)
            .map_err(|e| format!("Failed to send message: {:?}", e).into())
    }

    /// Register a callback for a specific response type
    pub fn register_callback<F>(&self, response_type: &str, callback: F)
    where
        F: Fn(Vec<u8>) + Send + Sync + 'static,
    {
        let mut callbacks_lock = self.callbacks.write().unwrap();
        callbacks_lock.insert(response_type.to_string(), Box::new(callback));
    }

    /// Subscribe to event for reconnection
    pub fn subscribe_reconnected(&self) -> Arc<Notify> {
        self.reconnected_notify.clone()
    }
}
impl Log for NestriWebSocket {
    fn enabled(&self, metadata: &Metadata) -> bool {
        metadata.level() <= Level::Info
    }

    fn log(&self, record: &Record) {
        if self.enabled(record.metadata()) {
            let level = record.level().to_string();
            let message = record.args().to_string();
            let time = chrono::Local::now().to_rfc3339();

            // Print to console as well
            println!("{}: {}", level, message);

            // Encode and send the log message
            let log_message = MessageLog {
                base: MessageBase {
                    payload_type: "log".to_string(),
                },
                level,
                message,
                time,
            };
            if let Ok(encoded_message) = encode_message(&log_message) {
                if let Err(e) = self.send_message(encoded_message) {
                    eprintln!("Failed to send log message: {:?}", e);
                }
            }
        }
    }

    fn flush(&self) {
        // No-op for this logger
    }
}
