//! PyroWave, a compute-shader wavelet video codec, on `ash`.
//!
//! A port of Hans-Kristian Arntzen's PyroWave (MIT) from C++ and Granite to
//! Rust, with the shaders ported from GLSL to Slang. The bitstream is
//! upstream's exactly, frozen at PyroWave `89f7e47`.
//!
//! PyroWave is intra-only: every frame stands alone, with no reference frames,
//! no entropy coding and no motion search. It spends bandwidth — around
//! 170 Mbit/s at 1080p60 — to buy latency that no hardware encoder matches,
//! which makes it the codec for a direct, wired path.

pub mod bitstream;
mod decoder;
mod device;
mod encoder;
mod error;
mod gpu;
mod pipeline;
mod rate;
mod sync;
mod wavelet;

pub use bitstream::{Chroma, ColourDescription, Matrix, Primaries, Range, Siting, Transfer};
pub use decoder::{DecodeConfig, DecodeStats, DecodedFrame, Decoder, PlaneView};
pub use device::{Context, DeviceFeatures, DeviceQueue, DeviceRequirements, Roles};
pub use encoder::{Depth, EncodeConfig, EncodeFuture, EncodeStats, EncodedFrame, Encoder, Source};
pub use error::{Error, Result};
pub use sync::{QueueLock, TimelinePoint};

/// The SPIR-V `build.rs` compiled, one module per pass and variant.
mod shaders {
    include!(concat!(env!("OUT_DIR"), "/shaders.rs"));
}
