use byteorder::{BigEndian, ByteOrder};
use libp2p::futures::io::{ReadHalf, WriteHalf};
use libp2p::futures::{AsyncReadExt, AsyncWriteExt};
use std::sync::Arc;
use tokio::sync::Mutex;

const MAX_SIZE: usize = 1024 * 1024; // 1MB

pub struct SafeStream {
    stream_read: Arc<Mutex<ReadHalf<libp2p::Stream>>>,
    stream_write: Arc<Mutex<WriteHalf<libp2p::Stream>>>,
}
impl SafeStream {
    pub fn new(stream: libp2p::Stream) -> Self {
        let (read, write) = stream.split();
        SafeStream {
            stream_read: Arc::new(Mutex::new(read)),
            stream_write: Arc::new(Mutex::new(write)),
        }
    }

    pub async fn send_raw(&self, data: &[u8]) -> Result<(), Box<dyn std::error::Error>> {
        self.send_with_length_prefix(data).await
    }

    pub async fn receive_raw(&self) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
        self.receive_with_length_prefix().await
    }

    async fn send_with_length_prefix(&self, data: &[u8]) -> Result<(), Box<dyn std::error::Error>> {
        if data.len() > MAX_SIZE {
            return Err("Data exceeds maximum size".into());
        }

        let mut buffer = Vec::with_capacity(4 + data.len());
        buffer.extend_from_slice(&(data.len() as u32).to_be_bytes()); // Length prefix
        buffer.extend_from_slice(data); // Payload

        let mut stream_write = self.stream_write.lock().await;
        stream_write.write_all(&buffer).await?; // Single write
        stream_write.flush().await?;
        Ok(())
    }

    async fn receive_with_length_prefix(&self) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
        let mut stream_read = self.stream_read.lock().await;

        // Read length prefix + data in one syscall
        let mut length_prefix = [0u8; 4];
        stream_read.read_exact(&mut length_prefix).await?;
        let length = BigEndian::read_u32(&length_prefix) as usize;

        if length > MAX_SIZE {
            return Err("Data exceeds maximum size".into());
        }

        let mut buffer = vec![0u8; length];
        stream_read.read_exact(&mut buffer).await?;
        Ok(buffer)
    }
}
