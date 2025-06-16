use byteorder::{BigEndian, ByteOrder};
use futures_util::io::{ReadHalf, WriteHalf};
use futures_util::{AsyncReadExt, AsyncWriteExt};
use prost::Message;
use serde::Serialize;
use serde::de::DeserializeOwned;
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

    pub async fn send_json<T: Serialize>(
        &self,
        data: &T,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let json_data = serde_json::to_vec(data)?;
        tracing::info!("Sending JSON");
        let e = self.send_with_length_prefix(&json_data).await;
        tracing::info!("Sent JSON");
        e
    }

    pub async fn receive_json<T: DeserializeOwned>(&self) -> Result<T, Box<dyn std::error::Error>> {
        let data = self.receive_with_length_prefix().await?;
        let msg = serde_json::from_slice(&data)?;
        Ok(msg)
    }

    pub async fn send_proto<M: Message>(&self, msg: &M) -> Result<(), Box<dyn std::error::Error>> {
        let mut proto_data = Vec::new();
        msg.encode(&mut proto_data)?;
        self.send_with_length_prefix(&proto_data).await
    }

    pub async fn receive_proto<M: Message + Default>(
        &self,
    ) -> Result<M, Box<dyn std::error::Error>> {
        let data = self.receive_with_length_prefix().await?;
        let msg = M::decode(&*data)?;
        Ok(msg)
    }

    pub async fn send_raw(&self, data: &[u8]) -> Result<(), Box<dyn std::error::Error>> {
        self.send_with_length_prefix(data).await
    }

    pub async fn receive_raw(&self) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
        self.receive_with_length_prefix().await
    }

    async fn send_with_length_prefix(&self, data: &[u8]) -> Result<(), Box<dyn std::error::Error>> {
        if data.len() > MAX_SIZE {
            return Err(Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "Data exceeds maximum size",
            )));
        }

        let mut stream_write = self.stream_write.lock().await;

        // Write the 4-byte length prefix
        let mut length_prefix = [0u8; 4];
        BigEndian::write_u32(&mut length_prefix, data.len() as u32);
        stream_write.write_all(&length_prefix).await?;

        // Write the actual data
        stream_write.write_all(data).await?;
        stream_write.flush().await?;
        Ok(())
    }

    async fn receive_with_length_prefix(&self) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
        let mut stream_read = self.stream_read.lock().await;

        // Read the 4-byte length prefix
        let mut length_prefix = [0u8; 4];
        stream_read.read_exact(&mut length_prefix).await?;
        let length = BigEndian::read_u32(&length_prefix) as usize;

        if length > MAX_SIZE {
            return Err(Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "Data exceeds maximum size",
            )));
        }

        // Read the actual data
        let mut buffer = vec![0; length];
        stream_read.read_exact(&mut buffer).await?;
        Ok(buffer)
    }
}
