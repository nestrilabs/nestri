use ash::vk;
use thiserror::Error;

use crate::bitstream::BitstreamError;

pub type Result<T, E = Error> = std::result::Result<T, E>;

#[derive(Debug, Error)]
pub enum Error {
    #[error("Vulkan: {0}")]
    Vulkan(vk::Result),
    /// The device lacks what the codec needs; every missing piece is named.
    #[error("device cannot run nespyro, missing: {}", .0.join(", "))]
    Unsupported(Vec<String>),
    #[error("invalid configuration: {0}")]
    Config(String),
    #[error(transparent)]
    Bitstream(#[from] BitstreamError),
    /// Every output slot is held by the caller; drop a frame and try again.
    #[error("every output slot is still held")]
    Busy,
    /// The encoder was shut down before the frame was read back.
    #[error("encoder shut down before the frame was read back")]
    Cancelled,
    /// Nothing to decode: no start-of-frame header yet, or already decoded.
    #[error("nothing to decode: {0}")]
    NotReady(&'static str),
}

impl From<vk::Result> for Error {
    fn from(r: vk::Result) -> Self {
        Error::Vulkan(r)
    }
}
