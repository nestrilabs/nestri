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
//!
//! # Using it
//!
//! nespyro runs on a device the caller creates. Ask
//! [`DeviceRequirements::query`] what to enable for the [`Roles`] the device
//! will have, merge that into the device's creation, and wrap the result with
//! [`Context::from_existing`].
//!
//! - [`Encoder::encode_after`] takes an RGB image and timeline points to wait
//!   on, and returns a future of an [`EncodedFrame`]: the frame's bytes, cut
//!   into packets that each parse on their own.
//! - [`Decoder::push_packet`] takes those packets in any order;
//!   [`Decoder::readiness`] says how much of the frame is there; and
//!   [`Decoder::decode_after`] returns its planes with the timeline point
//!   they are ready at.
//! - [`bitstream`] is the format itself, with no Vulkan in it.
//!
//! Only desktop GPUs are supported: upstream's fragment-shader and
//! texel-buffer paths for mobile GPUs are not carried. A device without what
//! the compute paths need is refused with everything it lacks named.
//!
//! # Testing
//!
//! `cargo test -p nespyro` runs the bitstream tests, which need no GPU. The
//! rest are `#[ignore]`d and say what they need; they fail rather than skip
//! when it is missing, and every GPU test runs under Khronos validation and
//! fails on any validation error.
//!
//! - `--test encode --test roundtrip -- --ignored`: a Vulkan 1.3 GPU. Pick
//!   one with `NESPYRO_TEST_DEVICE=<name substring>`.
//! - `--test reference --test bench -- --ignored`: also the C++ reference.
//!   Build it with `crates/nespyro/reference/build.sh <dir>` and point
//!   `NESPYRO_REFERENCE` at the harness it prints; on a machine with several
//!   GPUs, `NESPYRO_REFERENCE_VID=<PCI vendor id, hex>` puts it on the same
//!   one. Run `bench` with `--release`.

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
