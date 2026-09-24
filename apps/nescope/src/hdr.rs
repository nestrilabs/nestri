//! HDR / colour management protocol handlers.
//!
//! # HDR here is Wayland colour management
//!
//! A game gets HDR by being a Wayland client and asking for it through
//! `wp_color_manager_v1`, which Mesa turns into HDR colour spaces on the
//! surface. That is the whole mechanism, it works, and it needs nothing outside
//! this tree.
//!
//! Measured on RDNA4, and the asymmetry is the point:
//!
//! | surface | formats offered | HDR |
//! |---|---|---|
//! | Wayland | 21, incl. `A2B10G10R10` and `R16G16B16A16_SFLOAT` | yes |
//! | XWayland | 2, both 8-bit sRGB | no -- "surface offers no format in HDR10_ST2084_EXT" |
//!
//! Verified past the swapchain too, not just on the format list: a client
//! requesting `A2B10G10R10` + `HDR10_ST2084` comes out `yuv420p10le`, full
//! range, `bt2020nc` / `smpte2084` / `bt2020`.
//!
//! So the launch environment always sets `PROTON_ENABLE_WAYLAND=1` -- not as an
//! HDR switch but as the way a Windows title reaches the compositor at all,
//! since Proton renders through XWayland otherwise and XWayland is off by
//! default. `--hdr` adds `DXVK_HDR=1` (DXVK's dxgi gates HDR exposure on it).
//! Those two are what HDR needs.
//!
//! Mesa pairs the colour spaces it learns here with the pixel formats it
//! derives from our `zwp_linux_dmabuf_v1` list, so both halves have to be
//! present -- the surface offered nothing but `B8G8R8A8` until the format list
//! advertised the opaque FourCC spellings alongside the alpha ones. See the
//! list in `state.rs`, which is where that constraint lives.
//!
//! # `gamescope_swapchain_factory_v2` is the legacy route, and stays off
//!
//! Also implemented here, because it costs little and a host may deliberately
//! want it. It predates Wayland colour management and works the other way
//! round: a WSI layer inside the game's process appends HDR colour spaces Mesa
//! never offered, rewrites `imageColorSpace` to `SRGB_NONLINEAR` so the driver
//! is never told HDR is happening, and reports the real colour space to the
//! compositor over this protocol instead.
//!
//! It is not how we do HDR, for three reasons that all point the same way:
//!
//! - It needs a Vulkan layer this tree does not ship. Verified working with
//!   gamescope's own, unmodified -- the XML here is byte-identical to theirs,
//!   and the atoms written in `state.rs` are what it reads.
//! - It only helps the XWayland path, which is the path without HDR anyway.
//! - **Capture reads the colour space it hides.** A game asking for HDR10
//!   through it has its ten-bit PQ samples encoded and tagged BT.709 SDR, at
//!   full frame rate, decoding cleanly. Recorded where that value is read, in
//!   the capture layer's swapchain hook.
//!
//! That last one makes enabling it worse than leaving it off: it trades no HDR
//! for wrong HDR. So `GAMESCOPE_WAYLAND_DISPLAY` is set for the child but
//! `ENABLE_GAMESCOPE_WSI` deliberately is not, which leaves the layer inert
//! unless someone opts in. If anyone ever does want this path, the colour space
//! it reports arrives here and the capture layer cannot see it, so it would
//! need a channel from this process to that one.
//!
//! # What HDR does not cover
//!
//! A game that cannot be a Wayland client gets SDR, and XWayland is off by
//! default -- it costs input latency and a compositing hop, which is the wrong
//! trade for a streaming box, and Proton does not need it. `--xwayland` turns
//! it on for the shrinking set of X11-only native software, which then runs
//! without HDR: Mesa offers no HDR colour space on the XWayland surface, and
//! nothing in this module can change that.
//!
//! Still unexercised: no game has run, and the scRGB/FP16 arm has had no pixels
//! through it -- only HDR10 PQ.
//!
//! # Signalling paths, for reference
//!
//! Both feed [`HdrState`], which tracks the colour space the active surface has
//! declared. This module never converts anything itself.
//!
//! 1. **`wp_color_manager_v1`** -- the standard protocol, and the live one.
//! 2. **`gamescope_swapchain_factory_v2`** -- the legacy route described above,
//!    reachable only if a WSI layer is present and opted into.
#![allow(unused)]
use std::collections::HashMap;
use std::sync::Mutex;

use smithay::reexports::wayland_protocols::wp::color_management::v1::server::{
    wp_color_management_output_v1, wp_color_management_surface_feedback_v1,
    wp_color_management_surface_v1, wp_color_manager_v1, wp_image_description_creator_icc_v1,
    wp_image_description_creator_params_v1, wp_image_description_info_v1, wp_image_description_v1,
};
use smithay::reexports::wayland_protocols::wp::color_representation::v1::server::{
    wp_color_representation_manager_v1, wp_color_representation_surface_v1,
};
use smithay::reexports::wayland_server::protocol::wl_surface::WlSurface;
use smithay::reexports::wayland_server::{
    Client, DataInit, Dispatch, DisplayHandle, GlobalDispatch, New, Resource,
};

use crate::protocols::{
    gamescope_swapchain::GamescopeSwapchain,
    gamescope_swapchain_factory_v2::GamescopeSwapchainFactoryV2,
};
use crate::state::NescopeState;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Simplified color space used by the external capture library.
/// Where capture listens. Fixed rather than configurable: both ends are ours,
/// and a mismatch would be silent.
const CAPTURE_SOCKET: &str = "/tmp/nescapture-cmd.sock";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ColorSpace {
    /// BT.709 primaries, sRGB EOTF.
    Srgb,
    /// BT.2020 primaries, PQ (ST 2084) EOTF — HDR10.
    Bt2020Pq,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransferFunction {
    Gamma22,
    St2084Pq,
    /// Extended-range linear light, which is what scRGB is.
    ///
    /// Needed because it is the transfer a Windows title asks for when it
    /// turns HDR on: DXGI's HDR path is scRGB in FP16, and DXVK maps that to
    /// `VK_COLOR_SPACE_EXTENDED_SRGB_LINEAR_EXT`. Mesa only offers that colour
    /// space when the compositor names this transfer, so a compositor that
    /// does not is one where HDR silently does not happen.
    ExtLinear,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Primaries {
    Srgb,
    Bt2020,
}

/// How bright the session says it can go.
///
/// A game asks the display what it can do before deciding how to render. Under
/// wine that question reaches DXGI, DXGI asks the Wayland driver, and the
/// driver asks the compositor -- so it ends here. An HDR output that answers
/// with its primaries and transfer function and nothing about luminance tells
/// a title only that HDR exists, and a title that cannot find out how bright
/// the display goes renders as though it does not go far: exactly the flat,
/// SDR-bright picture this was measured producing.
///
/// These are the session's numbers, not a panel's. nescope drives a video
/// stream whose real display is on the other end of a network and is not
/// knowable here, so the defaults describe an ordinary HDR display and
/// `NESCOPE_HDR_MAX_NITS` / `NESCOPE_HDR_REFERENCE_NITS` exist for a person
/// who knows better than the default.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HdrTarget {
    /// Peak luminance, cd/m².
    pub max_nits: u32,
    /// Peak luminance sustained over a whole frame, cd/m². Real displays
    /// cannot hold their peak across the panel, and a title that plans its
    /// tone mapping around the small-area peak alone gets it wrong.
    pub max_fall_nits: u32,
    /// Reference white -- what diffuse white renders at. BT.2408 says 203,
    /// and it is the number a compositor maps its own SDR white onto.
    pub reference_nits: u32,
    /// Black level, in units of 0.0001 cd/m², as the protocol carries it.
    pub min_lum: u32,
}

impl Default for HdrTarget {
    fn default() -> Self {
        Self {
            // The protocol's own default for PQ, and comfortably above the
            // 250 nits below which DXVK reads a reported peak as "the driver
            // did not fill this in".
            max_nits: 1000,
            max_fall_nits: 600,
            reference_nits: 203,
            // 0.005 cd/m², which is what the protocol documents as the PQ
            // primary colour volume's minimum.
            min_lum: 50,
        }
    }
}

impl HdrTarget {
    /// Read the overrides, falling back to the default for anything absent or
    /// unreadable rather than refusing to start over a stray environment
    /// variable.
    pub fn from_env() -> Self {
        let read = |key: &str, fallback: u32| {
            std::env::var(key)
                .ok()
                .and_then(|v| v.trim().parse::<u32>().ok())
                .filter(|v| *v > 0)
                .unwrap_or(fallback)
        };
        let default = Self::default();
        Self {
            max_nits: read("NESCOPE_HDR_MAX_NITS", default.max_nits),
            max_fall_nits: read("NESCOPE_HDR_MAX_FALL_NITS", default.max_fall_nits),
            reference_nits: read("NESCOPE_HDR_REFERENCE_NITS", default.reference_nits),
            min_lum: default.min_lum,
        }
        .clamped()
    }

    /// Put an override back inside what a display can be.
    ///
    /// No panel sustains its small-area peak across the whole frame, so a
    /// full-frame luminance above the peak describes nothing. Clamped rather
    /// than refused: the person asked for a bright display and got the
    /// brightest coherent one.
    pub fn clamped(self) -> Self {
        Self {
            max_fall_nits: self.max_fall_nits.min(self.max_nits),
            ..self
        }
    }

    /// Whether this describes a volume at all.
    ///
    /// The protocol raises `invalid_luminance` on a range that does not go
    /// upwards, and the compositor is the one sending it here, so a bad
    /// override must be dropped rather than passed on.
    pub fn is_usable(&self) -> bool {
        self.max_nits as f64 > self.min_lum as f64 / 10_000.0 && self.max_nits > 0
    }
}

/// A resolved per-surface color / HDR description.
#[derive(Debug, Clone, Copy)]
pub struct ImageDescription {
    pub transfer_function: TransferFunction,
    pub primaries: Primaries,
    pub max_cll: Option<u32>,
    pub max_fall: Option<u32>,
    pub mastering_luminance: Option<(u32, u32)>,
    pub mastering_primaries: Option<[(u32, u32); 3]>,
    pub white_point: Option<(u32, u32)>,
    /// The primary colour volume's luminance range, as `(min * 10000, max,
    /// reference)` in cd/m². `None` says nothing, which is what an SDR
    /// description does and what this said about HDR until it was measured
    /// costing a title its highlights.
    pub luminances: Option<(u32, u32, u32)>,
    /// The target colour volume: what the display this is headed for can
    /// actually show. A title reads this to size its tone mapping, and wine
    /// maps it onto the luminance fields of `DXGI_OUTPUT_DESC1`.
    pub target: Option<HdrTarget>,
}

impl ImageDescription {
    pub fn srgb() -> Self {
        Self {
            transfer_function: TransferFunction::Gamma22,
            primaries: Primaries::Srgb,
            max_cll: None,
            max_fall: None,
            mastering_luminance: None,
            mastering_primaries: None,
            white_point: None,
            // SDR's luminance is the display's business and always has been.
            luminances: None,
            target: None,
        }
    }

    /// HDR10, saying how bright it goes.
    ///
    /// The luminances are the point: see [`HdrTarget`]. A description without
    /// them is what a title reads as "HDR, brightness unknown".
    pub fn bt2020_pq(target: HdrTarget) -> Self {
        Self {
            transfer_function: TransferFunction::St2084Pq,
            primaries: Primaries::Bt2020,
            max_cll: None,
            max_fall: None,
            mastering_luminance: None,
            mastering_primaries: None,
            white_point: None,
            luminances: target.is_usable().then_some((
                target.min_lum,
                target.max_nits,
                target.reference_nits,
            )),
            target: target.is_usable().then_some(target),
        }
    }

    /// Which of the two colour spaces this description is.
    ///
    /// scRGB reads as  here, which is not what it is: extended-range
    /// linear light is HDR, and this type has no way to say so. Left alone
    /// because nothing outside this module reads it -- capture takes the
    /// colour space from the game swapchain, not from here -- and inventing a
    /// third variant for a question nobody asks would be worse than the note.
    pub fn color_space(self) -> ColorSpace {
        if self.primaries == Primaries::Bt2020
            && self.transfer_function == TransferFunction::St2084Pq
        {
            ColorSpace::Bt2020Pq
        } else {
            ColorSpace::Srgb
        }
    }
}

// ---------------------------------------------------------------------------
// Resource user-data
// ---------------------------------------------------------------------------

pub struct ColorSurfaceData {
    pub surface: WlSurface,
}

pub struct ImageDescriptionUserData {
    pub desc: ImageDescription,
}

pub struct CreatorParamsUserData {
    pub params: Mutex<CreatorParams>,
}

#[derive(Debug, Default)]
pub struct CreatorParams {
    transfer_function: Option<TransferFunction>,
    primaries: Option<Primaries>,
    max_cll: Option<u32>,
    max_fall: Option<u32>,
    mastering_luminance: Option<(u32, u32)>,
    mastering_primaries: Option<[(u32, u32); 3]>,
    white_point: Option<(u32, u32)>,
    luminances: Option<(u32, u32, u32)>,
}

pub struct ColorOutputData;
pub struct ColorSurfaceFeedbackData {
    pub surface: WlSurface,
}
pub struct ImageDescriptionInfoData;
pub struct IccCreatorData;
pub struct ColorRepresentationSurfaceData;

// User data for gamescope protocol objects.
pub struct SwapchainFactoryData;
pub struct SwapchainData {
    pub surface: WlSurface,
}

// ---------------------------------------------------------------------------
// HdrState
// ---------------------------------------------------------------------------

/// Per-compositor HDR / color management state.
pub struct HdrState {
    /// Whether HDR protocols are advertised to clients.
    pub enabled: bool,
    /// How bright this session says it goes. See [`HdrTarget`].
    pub target: HdrTarget,
    /// Pending (not-yet-committed) image descriptions keyed by surface.
    pending: HashMap<WlSurface, Option<ImageDescription>>,
    /// Committed image descriptions keyed by surface.
    current: HashMap<WlSurface, ImageDescription>,
    /// Information requests waiting to be answered after the request that
    /// created them has returned. See [`HdrState::queue_information`].
    pending_information: Vec<(
        wp_image_description_info_v1::WpImageDescriptionInfoV1,
        ImageDescription,
    )>,
    /// Where capture is told what the compositor was told.
    ///
    /// Capture reads the colour space from the game's Vulkan swapchain, and a
    /// swapchain set to `PASS_THROUGH` carries none -- the surface's colour is
    /// declared here instead, and only here. So it goes across.
    ///
    /// `None` when a socket cannot be opened at all, which is not worth
    /// failing a compositor over.
    capture_socket: Option<std::os::unix::net::UnixDatagram>,
    /// The last thing sent, so an unchanged surface does not resend on every
    /// commit -- which is every frame.
    last_sent: Option<nesprotocol::SurfaceColor>,
}

impl HdrState {
    /// Create state and, if `enabled`, register the protocol globals.
    pub fn new(display: &DisplayHandle, enabled: bool) -> Self {
        if enabled {
            display.create_global::<NescopeState, wp_color_manager_v1::WpColorManagerV1, _>(1, ());
            display.create_global::<NescopeState, wp_color_representation_manager_v1::WpColorRepresentationManagerV1, _>(1, ());
            register_gamescope_swapchain(display);
            tracing::info!(
                "HDR protocols registered (wp_color_management_v1 + gamescope_swapchain)"
            );
        }

        let target = HdrTarget::from_env();
        if enabled {
            tracing::info!(
                "HDR output advertised at {} nits peak, {} nits full-frame, {} nits reference white",
                target.max_nits,
                target.max_fall_nits,
                target.reference_nits
            );
            // The clients cannot be told this one. A client declares its
            // stream through `VK_EXT_hdr_metadata`, which carries a luminance
            // range and two light levels and has no field for a reference
            // white -- so a compositor at the far end assumes PQ's default of
            // 203 nits whatever was used here. Moving it makes the game render
            // its diffuse white somewhere the far end will not look for it,
            // and the picture arrives uniformly too bright or too dim.
            if target.reference_nits != HdrTarget::default().reference_nits {
                tracing::warn!(
                    "reference white moved to {} nits; the clients will still read the stream as {} and show it that much brighter or darker",
                    target.reference_nits,
                    HdrTarget::default().reference_nits
                );
            }
        }

        Self {
            enabled,
            target,
            pending: HashMap::new(),
            current: HashMap::new(),
            pending_information: Vec::new(),
            capture_socket: std::os::unix::net::UnixDatagram::unbound().ok(),
            last_sent: None,
        }
    }

    // ── Pending state ─────────────────────────────────────────────────────

    /// Remember an information object to answer once the request that made
    /// it has returned. See the call site for why it cannot be answered there.
    pub fn queue_information(
        &mut self,
        info: wp_image_description_info_v1::WpImageDescriptionInfoV1,
        desc: ImageDescription,
    ) {
        self.pending_information.push((info, desc));
    }

    /// Answer every queued information request.
    ///
    /// Called once per loop iteration. The protocol does not say how promptly
    /// `done` must follow, only that it ends the sequence, so a client waiting
    /// on it waits one dispatch longer and nothing else changes.
    pub fn flush_information(&mut self) {
        for (info, desc) in self.pending_information.drain(..) {
            match desc.transfer_function {
                TransferFunction::St2084Pq => {
                    info.tf_named(wp_color_manager_v1::TransferFunction::St2084Pq)
                }
                TransferFunction::ExtLinear => {
                    info.tf_named(wp_color_manager_v1::TransferFunction::ExtLinear)
                }
                TransferFunction::Gamma22 => {
                    info.tf_named(wp_color_manager_v1::TransferFunction::Gamma22)
                }
            }
            match desc.primaries {
                Primaries::Bt2020 => info.primaries_named(wp_color_manager_v1::Primaries::Bt2020),
                Primaries::Srgb => info.primaries_named(wp_color_manager_v1::Primaries::Srgb),
            }
            // Both the volume and the target: the first says what the
            // description covers, the second what a renderer should aim at.
            // A title reads one or the other depending on its driver, and
            // sending only one leaves half of them none the wiser.
            if let Some((min_lum, max_lum, reference_lum)) = desc.luminances {
                info.luminances(min_lum, max_lum, reference_lum);
            }
            // The target volume is the display's, and it is the half a title
            // reads to decide how bright to render. Sent whole: wine maps the
            // range onto `MinLuminance`/`MaxLuminance` and the two light
            // levels onto the peak and full-frame fields beside them, and a
            // field it cannot fill is one the title plans around not having.
            if let Some(target) = desc.target {
                info.target_luminance(target.min_lum, target.max_nits);
                info.target_max_cll(target.max_nits);
                info.target_max_fall(target.max_fall_nits);
            }
            info.done();
        }
    }

    pub fn set_pending(&mut self, surface: &WlSurface, desc: ImageDescription) {
        tracing::debug!(
            surface_id = ?surface.id(),
            color_space = ?desc.color_space(),
            "HDR: set_pending"
        );
        self.pending.insert(surface.clone(), Some(desc));
    }

    pub fn unset_pending(&mut self, surface: &WlSurface) {
        self.pending.insert(surface.clone(), None);
    }

    /// Apply pending state on `wl_surface.commit`.
    pub fn commit(&mut self, surface: &WlSurface) {
        if let Some(pending) = self.pending.remove(surface) {
            match pending {
                Some(desc) => {
                    tracing::debug!(
                        surface_id = ?surface.id(),
                        color_space = ?desc.color_space(),
                        "HDR: committed"
                    );
                    self.current.insert(surface.clone(), desc);
                }
                None => {
                    self.current.remove(surface);
                }
            }
            self.tell_capture();
        }
    }

    /// Tell capture what the active surface's colour is, when it changes.
    ///
    /// Sent rather than asked for, because capture lives inside the game's
    /// process and has no way to reach a compositor object. Unreliable by
    /// construction -- a datagram to a socket that may not be bound yet -- and
    /// that is the right trade here: the next commit sends it again, and
    /// commits are frequent. Blocking a compositor commit on a process that
    /// may not exist would not be.
    fn tell_capture(&mut self) {
        let Some(socket) = self.capture_socket.as_ref() else {
            return;
        };
        let colour = self.surface_color_message();
        if self.last_sent == Some(colour) {
            return;
        }

        let mut payload = vec![nesprotocol::MSG_SURFACE_COLOR];
        nesprotocol::encode_surface_color(&mut payload, &colour);
        match socket.send_to(&payload, CAPTURE_SOCKET) {
            Ok(_) => {
                tracing::info!(
                    space = colour.space,
                    max_cll = colour.max_cll,
                    max_fall = colour.max_fall,
                    max_luminance = colour.max_luminance,
                    "told capture what this surface is"
                );
                self.last_sent = Some(colour);
            }
            // Not a warning. No capture attached is the ordinary state for a
            // compositor running on its own, and this fires per commit.
            Err(e) => tracing::trace!("capture is not listening: {e}"),
        }
    }

    /// What to tell capture, from the surfaces currently mapped.
    ///
    /// Any HDR surface makes the answer HDR. A session is one game on one
    /// screen, so "any" and "the one that matters" are the same set, and
    /// picking between several would need a notion of active this does not
    /// have.
    fn surface_color_message(&self) -> nesprotocol::SurfaceColor {
        let hdr = self
            .current
            .values()
            .find(|desc| desc.color_space() == ColorSpace::Bt2020Pq);
        match hdr {
            // A game that states its own mastering metadata is believed. One
            // that states none is not unknown: it asked what the session could
            // do, was told, and rendered for that -- so the session's target
            // is what its frames were mastered for, and saying nothing instead
            // leaves the far end to assume the PQ default of 10000 nits and
            // tone map a range the picture never uses.
            Some(desc) => nesprotocol::SurfaceColor {
                space: nesprotocol::SURFACE_COLOR_BT2020_PQ,
                max_cll: desc.max_cll.unwrap_or(self.target.max_nits),
                max_fall: desc.max_fall.unwrap_or(self.target.max_fall_nits),
                min_luminance: desc
                    .mastering_luminance
                    .map(|(min, _)| min)
                    .unwrap_or(self.target.min_lum),
                max_luminance: desc
                    .mastering_luminance
                    .map(|(_, max)| max)
                    .unwrap_or(self.target.max_nits.saturating_mul(10_000)),
            },
            None => nesprotocol::SurfaceColor {
                space: nesprotocol::SURFACE_COLOR_SRGB,
                ..Default::default()
            },
        }
    }

    /// Drop what was remembered about a surface, and say so.
    ///
    /// Separate from [`Self::surface_destroyed`] because the `wl_surface` may
    /// well outlive the colour-management object attached to it: a game
    /// leaving HDR keeps its window.
    pub fn forget(&mut self, surface: &WlSurface) {
        self.pending.remove(surface);
        if self.current.remove(surface).is_some() {
            self.tell_capture();
        }
    }

    pub fn surface_destroyed(&mut self, surface: &WlSurface) {
        self.pending.remove(surface);
        self.current.remove(surface);
    }

    // ── Queries ───────────────────────────────────────────────────────────

    /// Active color space of the fullscreen surface.
    ///
    /// Returns `Bt2020Pq` if any mapped surface has declared BT.2020+PQ,
    /// otherwise `Srgb`.
    pub fn color_space(&self) -> ColorSpace {
        for desc in self.current.values() {
            if desc.color_space() == ColorSpace::Bt2020Pq {
                return ColorSpace::Bt2020Pq;
            }
        }
        ColorSpace::Srgb
    }

    /// HDR metadata from the active surface, if available.
    pub fn hdr_metadata(&self) -> Option<HdrMetadata> {
        for desc in self.current.values() {
            if desc.color_space() != ColorSpace::Bt2020Pq {
                continue;
            }
            if desc.max_cll.is_none()
                && desc.max_fall.is_none()
                && desc.mastering_luminance.is_none()
            {
                continue;
            }
            let sat = |v: u32| v.min(u16::MAX as u32) as u16;
            return Some(HdrMetadata {
                display_primaries: desc.mastering_primaries.map_or([(0, 0); 3], |p| {
                    [
                        (sat(p[0].0), sat(p[0].1)),
                        (sat(p[1].0), sat(p[1].1)),
                        (sat(p[2].0), sat(p[2].1)),
                    ]
                }),
                white_point: desc.white_point.map_or((0, 0), |(x, y)| (sat(x), sat(y))),
                max_luminance: desc.mastering_luminance.map_or(0, |(_, max)| max),
                min_luminance: desc.mastering_luminance.map_or(0, |(min, _)| min),
                max_cll: sat(desc.max_cll.unwrap_or(0)),
                max_fall: sat(desc.max_fall.unwrap_or(0)),
            });
        }
        None
    }
}

/// Static HDR10 metadata for the capture layer.
#[derive(Debug, Clone, Copy)]
pub struct HdrMetadata {
    /// CIE 1931 xy primaries in 0.00002 units.
    pub display_primaries: [(u16, u16); 3],
    /// CIE 1931 xy white point in 0.00002 units.
    pub white_point: (u16, u16),
    /// Max mastering luminance in 0.0001 cd/m².
    pub max_luminance: u32,
    /// Min mastering luminance in 0.0001 cd/m².
    pub min_luminance: u32,
    /// Max content light level in cd/m².
    pub max_cll: u16,
    /// Max frame-average light level in cd/m².
    pub max_fall: u16,
}

// ---------------------------------------------------------------------------
// gamescope_swapchain — register global
// ---------------------------------------------------------------------------

const VK_COLOR_SPACE_HDR10_ST2084_EXT: u32 = 1000104008;

pub fn register_gamescope_swapchain(display: &DisplayHandle) {
    display.create_global::<NescopeState, GamescopeSwapchainFactoryV2, _>(1, ());
}

// ---------------------------------------------------------------------------
// gamescope_swapchain_factory_v2 — Global + Dispatch
// ---------------------------------------------------------------------------

impl GlobalDispatch<GamescopeSwapchainFactoryV2, ()> for NescopeState {
    fn bind(
        _: &mut Self,
        _: &DisplayHandle,
        _: &Client,
        resource: New<GamescopeSwapchainFactoryV2>,
        _: &(),
        data_init: &mut DataInit<'_, Self>,
    ) {
        tracing::debug!("gamescope_swapchain_factory_v2 bound");
        data_init.init(resource, SwapchainFactoryData);
    }
}

impl Dispatch<GamescopeSwapchainFactoryV2, SwapchainFactoryData> for NescopeState {
    fn request(
        _: &mut Self,
        _: &Client,
        _: &GamescopeSwapchainFactoryV2,
        request: <GamescopeSwapchainFactoryV2 as Resource>::Request,
        _: &SwapchainFactoryData,
        _: &DisplayHandle,
        data_init: &mut DataInit<'_, Self>,
    ) {
        use crate::protocols::gamescope_swapchain_factory_v2::Request;
        match request {
            Request::CreateSwapchain { surface, callback } => {
                tracing::debug!("gamescope_swapchain_factory_v2: create_swapchain");
                data_init.init(callback, SwapchainData { surface });
            }
            Request::Destroy => {}
        }
    }
}

// ---------------------------------------------------------------------------
// gamescope_swapchain — Dispatch
// ---------------------------------------------------------------------------

impl Dispatch<GamescopeSwapchain, SwapchainData> for NescopeState {
    fn request(
        state: &mut Self,
        _: &Client,
        _: &GamescopeSwapchain,
        request: <GamescopeSwapchain as Resource>::Request,
        data: &SwapchainData,
        _: &DisplayHandle,
        _: &mut DataInit<'_, Self>,
    ) {
        use crate::protocols::gamescope_swapchain::Request;
        match request {
            Request::SwapchainFeedback {
                vk_colorspace,
                vk_format,
                vk_engine_name,
                ..
            } => {
                tracing::debug!(
                    vk_colorspace,
                    vk_format,
                    vk_engine_name,
                    "gamescope_swapchain: swapchain_feedback — registering as Vulkan surface"
                );
                // Record this as a known Vulkan surface (used for focus routing).
                state.vulkan_surfaces.insert(data.surface.clone());

                if vk_colorspace == VK_COLOR_SPACE_HDR10_ST2084_EXT {
                    let desc = ImageDescription::bt2020_pq(state.hdr.target);
                    state.hdr.set_pending(&data.surface, desc);
                } else {
                    state
                        .hdr
                        .set_pending(&data.surface, ImageDescription::srgb());
                }
            }

            Request::OverrideWindowContent {
                x11_window,
                gamescope_xwayland_server_id: _,
            } => {
                tracing::debug!(
                    x11_window,
                    "gamescope_swapchain: override_window_content — WSI bypass surface"
                );
                state.vulkan_surfaces.insert(data.surface.clone());
                state.override_window_surface(x11_window, data.surface.clone());
            }

            Request::SetHdrMetadata {
                display_primary_red_x,
                display_primary_red_y,
                display_primary_green_x,
                display_primary_green_y,
                display_primary_blue_x,
                display_primary_blue_y,
                white_point_x,
                white_point_y,
                max_display_mastering_luminance,
                min_display_mastering_luminance,
                max_cll,
                max_fall,
            } => {
                tracing::debug!(
                    max_cll,
                    max_fall,
                    max_display_mastering_luminance,
                    min_display_mastering_luminance,
                    "gamescope_swapchain: set_hdr_metadata"
                );
                let desc = ImageDescription {
                    transfer_function: TransferFunction::St2084Pq,
                    primaries: Primaries::Bt2020,
                    max_cll: Some(max_cll),
                    max_fall: Some(max_fall),
                    // max_display_mastering_luminance is in cd/m², normalize to 0.0001 units.
                    mastering_luminance: Some((
                        min_display_mastering_luminance,
                        max_display_mastering_luminance.saturating_mul(10000),
                    )),
                    mastering_primaries: Some([
                        (display_primary_red_x, display_primary_red_y),
                        (display_primary_green_x, display_primary_green_y),
                        (display_primary_blue_x, display_primary_blue_y),
                    ]),
                    white_point: Some((white_point_x, white_point_y)),
                    // Mastering metadata: what the content was graded on, not
                    // the volume the surface covers.
                    luminances: None,
                    target: None,
                };
                state.hdr.set_pending(&data.surface, desc);
            }

            Request::SetPresentMode { .. } | Request::SetPresentTime { .. } | Request::Destroy => {}
        }
    }
}

// ===========================================================================
// wp_color_manager_v1
// ===========================================================================

impl GlobalDispatch<wp_color_manager_v1::WpColorManagerV1, ()> for NescopeState {
    fn bind(
        _: &mut Self,
        _: &DisplayHandle,
        _: &Client,
        resource: New<wp_color_manager_v1::WpColorManagerV1>,
        _: &(),
        data_init: &mut DataInit<'_, Self>,
    ) {
        tracing::debug!("wp_color_manager_v1 bound");
        let res = data_init.init(resource, ());
        res.supported_intent(wp_color_manager_v1::RenderIntent::Perceptual);
        res.supported_feature(wp_color_manager_v1::Feature::Parametric);
        res.supported_feature(wp_color_manager_v1::Feature::SetPrimaries);
        res.supported_feature(wp_color_manager_v1::Feature::SetMasteringDisplayPrimaries);
        res.supported_feature(wp_color_manager_v1::Feature::ExtendedTargetVolume);
        res.supported_feature(wp_color_manager_v1::Feature::SetLuminances);
        res.supported_feature(wp_color_manager_v1::Feature::WindowsScrgb);
        res.supported_tf_named(wp_color_manager_v1::TransferFunction::Srgb);
        res.supported_tf_named(wp_color_manager_v1::TransferFunction::Gamma22);
        res.supported_tf_named(wp_color_manager_v1::TransferFunction::St2084Pq);
        // scRGB. Mesa pairs this with sRGB primaries to offer
        // `EXTENDED_SRGB_LINEAR`, which is the colour space DXVK asks for when
        // a Windows title enables HDR -- see `TransferFunction::ExtLinear`.
        // Without it a game gets its float16 swapchain tagged SRGB_NONLINEAR
        // and every value in it read as if it were ordinary sRGB.
        res.supported_tf_named(wp_color_manager_v1::TransferFunction::ExtLinear);
        res.supported_primaries_named(wp_color_manager_v1::Primaries::Srgb);
        res.supported_primaries_named(wp_color_manager_v1::Primaries::Bt2020);
        res.done();
    }
}

impl Dispatch<wp_color_manager_v1::WpColorManagerV1, ()> for NescopeState {
    fn request(
        state: &mut Self,
        _: &Client,
        _: &wp_color_manager_v1::WpColorManagerV1,
        request: wp_color_manager_v1::Request,
        _: &(),
        _: &DisplayHandle,
        data_init: &mut DataInit<'_, Self>,
    ) {
        match request {
            wp_color_manager_v1::Request::Destroy => {}
            wp_color_manager_v1::Request::GetSurface { id, surface } => {
                data_init.init(id, ColorSurfaceData { surface });
            }
            wp_color_manager_v1::Request::GetOutput { id, .. } => {
                data_init.init(id, ColorOutputData);
            }
            wp_color_manager_v1::Request::GetSurfaceFeedback { id, surface } => {
                data_init.init(id, ColorSurfaceFeedbackData { surface });
            }
            wp_color_manager_v1::Request::CreateParametricCreator { obj } => {
                data_init.init(
                    obj,
                    CreatorParamsUserData {
                        params: Mutex::new(CreatorParams::default()),
                    },
                );
            }
            wp_color_manager_v1::Request::CreateIccCreator { obj } => {
                data_init.init(obj, IccCreatorData);
            }
            wp_color_manager_v1::Request::CreateWindowsScrgb { image_description } => {
                // Windows scRGB is declared as BT.2020+PQ by Proton's gamescope WSI
                // after converting the surface, so treat it as HDR.
                let res = data_init.init(
                    image_description,
                    ImageDescriptionUserData {
                        desc: ImageDescription::bt2020_pq(state.hdr.target),
                    },
                );
                res.ready(0);
            }
            _ => {}
        }
    }
}

// ===========================================================================
// wp_color_management_surface_v1
// ===========================================================================

impl Dispatch<wp_color_management_surface_v1::WpColorManagementSurfaceV1, ColorSurfaceData>
    for NescopeState
{
    fn request(
        state: &mut Self,
        _: &Client,
        _: &wp_color_management_surface_v1::WpColorManagementSurfaceV1,
        request: wp_color_management_surface_v1::Request,
        data: &ColorSurfaceData,
        _: &DisplayHandle,
        _: &mut DataInit<'_, Self>,
    ) {
        match request {
            wp_color_management_surface_v1::Request::SetImageDescription {
                image_description,
                ..
            } => {
                if let Some(d) = image_description.data::<ImageDescriptionUserData>() {
                    state.hdr.set_pending(&data.surface, d.desc);
                }
            }
            wp_color_management_surface_v1::Request::UnsetImageDescription => {
                state.hdr.unset_pending(&data.surface);
            }
            // Destroying the object removes the image description from the
            // surface as surely as unsetting it does, and a client leaving HDR
            // may well do it this way. Landing in the catch-all left the
            // surface remembered as HDR for the rest of the session.
            wp_color_management_surface_v1::Request::Destroy => {
                state.hdr.unset_pending(&data.surface);
                state.hdr.forget(&data.surface);
            }
            _ => {}
        }
    }

    fn destroyed(
        state: &mut Self,
        _: smithay::reexports::wayland_server::backend::ClientId,
        _: &wp_color_management_surface_v1::WpColorManagementSurfaceV1,
        data: &ColorSurfaceData,
    ) {
        // Also reached when the client goes away without tidying up.
        state.hdr.forget(&data.surface);
    }
}

// ===========================================================================
// wp_image_description_creator_params_v1
// ===========================================================================

impl
    Dispatch<
        wp_image_description_creator_params_v1::WpImageDescriptionCreatorParamsV1,
        CreatorParamsUserData,
    > for NescopeState
{
    fn request(
        _: &mut Self,
        _: &Client,
        _: &wp_image_description_creator_params_v1::WpImageDescriptionCreatorParamsV1,
        request: wp_image_description_creator_params_v1::Request,
        data: &CreatorParamsUserData,
        _: &DisplayHandle,
        data_init: &mut DataInit<'_, Self>,
    ) {
        match request {
            wp_image_description_creator_params_v1::Request::Create { image_description } => {
                let p = data.params.lock().unwrap();
                let desc = ImageDescription {
                    transfer_function: p.transfer_function.unwrap_or(TransferFunction::Gamma22),
                    primaries: p.primaries.unwrap_or(Primaries::Srgb),
                    max_cll: p.max_cll,
                    max_fall: p.max_fall,
                    mastering_luminance: p.mastering_luminance,
                    mastering_primaries: p.mastering_primaries,
                    white_point: p.white_point,
                    luminances: p.luminances,
                    target: None,
                };
                let r = data_init.init(image_description, ImageDescriptionUserData { desc });
                r.ready(0);
            }
            wp_image_description_creator_params_v1::Request::SetLuminances {
                min_lum,
                max_lum,
                reference_lum,
            } => {
                // Advertised as a supported feature, so a client that uses it
                // is entitled to have it mean something. It used to land in
                // the catch-all and vanish.
                data.params.lock().unwrap().luminances = Some((min_lum, max_lum, reference_lum));
            }
            wp_image_description_creator_params_v1::Request::SetTfNamed { tf } => {
                let tf = match tf.into_result() {
                    Ok(wp_color_manager_v1::TransferFunction::St2084Pq) => {
                        TransferFunction::St2084Pq
                    }
                    Ok(wp_color_manager_v1::TransferFunction::ExtLinear) => {
                        TransferFunction::ExtLinear
                    }
                    _ => TransferFunction::Gamma22,
                };
                data.params.lock().unwrap().transfer_function = Some(tf);
            }
            wp_image_description_creator_params_v1::Request::SetPrimariesNamed { primaries } => {
                let p = match primaries.into_result() {
                    Ok(wp_color_manager_v1::Primaries::Bt2020) => Primaries::Bt2020,
                    _ => Primaries::Srgb,
                };
                data.params.lock().unwrap().primaries = Some(p);
            }
            wp_image_description_creator_params_v1::Request::SetMaxCll { max_cll } => {
                data.params.lock().unwrap().max_cll = Some(max_cll);
            }
            wp_image_description_creator_params_v1::Request::SetMaxFall { max_fall } => {
                data.params.lock().unwrap().max_fall = Some(max_fall);
            }
            wp_image_description_creator_params_v1::Request::SetMasteringLuminance {
                min_lum,
                max_lum,
            } => {
                // max_lum is in cd/m², min_lum is already in 0.0001 cd/m² units.
                data.params.lock().unwrap().mastering_luminance =
                    Some((min_lum, max_lum.saturating_mul(10000)));
            }
            wp_image_description_creator_params_v1::Request::SetMasteringDisplayPrimaries {
                r_x,
                r_y,
                g_x,
                g_y,
                b_x,
                b_y,
                w_x,
                w_y,
            } => {
                // Protocol values are in 1/1,000,000 chromaticity; convert to 0.00002 units.
                let to_cta = |v: i32| (v.max(0) as u32) / 20;
                let mut p = data.params.lock().unwrap();
                p.mastering_primaries = Some([
                    (to_cta(r_x), to_cta(r_y)),
                    (to_cta(g_x), to_cta(g_y)),
                    (to_cta(b_x), to_cta(b_y)),
                ]);
                p.white_point = Some((to_cta(w_x), to_cta(w_y)));
            }
            _ => {}
        }
    }
}

// ===========================================================================
// wp_image_description_v1
// ===========================================================================

impl Dispatch<wp_image_description_v1::WpImageDescriptionV1, ImageDescriptionUserData>
    for NescopeState
{
    fn request(
        state: &mut Self,
        _: &Client,
        _: &wp_image_description_v1::WpImageDescriptionV1,
        request: wp_image_description_v1::Request,
        data: &ImageDescriptionUserData,
        _: &DisplayHandle,
        data_init: &mut DataInit<'_, Self>,
    ) {
        if let wp_image_description_v1::Request::GetInformation { information } = request {
            // Answered after this returns, not here. `done` destroys the
            // object, and destroying it inside the request that created it
            // takes the id out of the client's map before the backend has
            // attached the data this handler just returned -- which it then
            // unwraps, and panics on. The whole compositor goes down the first
            // time a client asks what colour space it has.
            let info = data_init.init(information, ImageDescriptionInfoData);
            state.hdr.queue_information(info, data.desc);
        }
    }
}

// ===========================================================================
// Minimal stubs for remaining protocol objects
// ===========================================================================

impl Dispatch<wp_image_description_info_v1::WpImageDescriptionInfoV1, ImageDescriptionInfoData>
    for NescopeState
{
    fn request(
        _: &mut Self,
        _: &Client,
        _: &wp_image_description_info_v1::WpImageDescriptionInfoV1,
        _: wp_image_description_info_v1::Request,
        _: &ImageDescriptionInfoData,
        _: &DisplayHandle,
        _: &mut DataInit<'_, Self>,
    ) {
    }
}

impl Dispatch<wp_color_management_output_v1::WpColorManagementOutputV1, ColorOutputData>
    for NescopeState
{
    fn request(
        state: &mut Self,
        _: &Client,
        _: &wp_color_management_output_v1::WpColorManagementOutputV1,
        request: wp_color_management_output_v1::Request,
        _: &ColorOutputData,
        _: &DisplayHandle,
        data_init: &mut DataInit<'_, Self>,
    ) {
        if let wp_color_management_output_v1::Request::GetImageDescription { image_description } =
            request
        {
            let desc = if state.hdr.enabled {
                ImageDescription::bt2020_pq(state.hdr.target)
            } else {
                ImageDescription::srgb()
            };
            let r = data_init.init(image_description, ImageDescriptionUserData { desc });
            r.ready(0);
        }
    }
}

impl
    Dispatch<
        wp_color_management_surface_feedback_v1::WpColorManagementSurfaceFeedbackV1,
        ColorSurfaceFeedbackData,
    > for NescopeState
{
    fn request(
        state: &mut Self,
        _: &Client,
        _: &wp_color_management_surface_feedback_v1::WpColorManagementSurfaceFeedbackV1,
        request: wp_color_management_surface_feedback_v1::Request,
        _: &ColorSurfaceFeedbackData,
        _: &DisplayHandle,
        data_init: &mut DataInit<'_, Self>,
    ) {
        match request {
            wp_color_management_surface_feedback_v1::Request::GetPreferred {
                image_description,
            }
            | wp_color_management_surface_feedback_v1::Request::GetPreferredParametric {
                image_description,
            } => {
                let desc = if state.hdr.enabled {
                    ImageDescription::bt2020_pq(state.hdr.target)
                } else {
                    ImageDescription::srgb()
                };
                let r = data_init.init(image_description, ImageDescriptionUserData { desc });
                r.ready(0);
            }
            _ => {}
        }
    }
}

impl Dispatch<wp_image_description_creator_icc_v1::WpImageDescriptionCreatorIccV1, IccCreatorData>
    for NescopeState
{
    fn request(
        _: &mut Self,
        _: &Client,
        _: &wp_image_description_creator_icc_v1::WpImageDescriptionCreatorIccV1,
        request: wp_image_description_creator_icc_v1::Request,
        _: &IccCreatorData,
        _: &DisplayHandle,
        data_init: &mut DataInit<'_, Self>,
    ) {
        if let wp_image_description_creator_icc_v1::Request::Create { image_description } = request
        {
            let r = data_init.init(
                image_description,
                ImageDescriptionUserData {
                    desc: ImageDescription::srgb(),
                },
            );
            r.failed(
                wp_image_description_v1::Cause::Unsupported,
                "ICC profiles not supported".into(),
            );
        }
    }
}

impl GlobalDispatch<wp_color_representation_manager_v1::WpColorRepresentationManagerV1, ()>
    for NescopeState
{
    fn bind(
        _: &mut Self,
        _: &DisplayHandle,
        _: &Client,
        resource: New<wp_color_representation_manager_v1::WpColorRepresentationManagerV1>,
        _: &(),
        data_init: &mut DataInit<'_, Self>,
    ) {
        let r = data_init.init(resource, ());
        r.supported_alpha_mode(wp_color_representation_surface_v1::AlphaMode::Straight);
        r.supported_alpha_mode(
            wp_color_representation_surface_v1::AlphaMode::PremultipliedElectrical,
        );
        r.supported_coefficients_and_ranges(
            wp_color_representation_surface_v1::Coefficients::Identity,
            wp_color_representation_surface_v1::Range::Full,
        );
        r.done();
    }
}

impl Dispatch<wp_color_representation_manager_v1::WpColorRepresentationManagerV1, ()>
    for NescopeState
{
    fn request(
        _: &mut Self,
        _: &Client,
        _: &wp_color_representation_manager_v1::WpColorRepresentationManagerV1,
        request: wp_color_representation_manager_v1::Request,
        _: &(),
        _: &DisplayHandle,
        data_init: &mut DataInit<'_, Self>,
    ) {
        if let wp_color_representation_manager_v1::Request::GetSurface { id, .. } = request {
            data_init.init(id, ColorRepresentationSurfaceData);
        }
    }
}

impl
    Dispatch<
        wp_color_representation_surface_v1::WpColorRepresentationSurfaceV1,
        ColorRepresentationSurfaceData,
    > for NescopeState
{
    fn request(
        _: &mut Self,
        _: &Client,
        _: &wp_color_representation_surface_v1::WpColorRepresentationSurfaceV1,
        _: wp_color_representation_surface_v1::Request,
        _: &ColorRepresentationSurfaceData,
        _: &DisplayHandle,
        _: &mut DataInit<'_, Self>,
    ) {
    }
}

#[cfg(test)]
mod hdr_target_tests {
    use super::{HdrTarget, ImageDescription, Primaries, TransferFunction};

    /// The default is the protocol's own for PQ, and the peak is deliberately
    /// well above 250: DXVK reads a reported peak below that as the driver
    /// having failed to fill the field in, and a title told nothing renders as
    /// though the display does not go far.
    #[test]
    fn the_default_describes_an_ordinary_hdr_display() {
        let t = HdrTarget::default();
        assert_eq!(t.reference_nits, 203);
        assert_eq!(t.min_lum, 50);
        assert!(t.max_nits > 250);
        assert!(t.is_usable());
    }

    /// The bug this exists for: an HDR output that names its primaries and
    /// transfer function and nothing about luminance tells a title only that
    /// HDR exists. Measured cost was a game rendering a 203-nit peak.
    #[test]
    fn an_hdr_description_says_how_bright_it_goes() {
        let t = HdrTarget::default();
        let desc = ImageDescription::bt2020_pq(t);
        assert_eq!(desc.transfer_function, TransferFunction::St2084Pq);
        assert_eq!(desc.primaries, Primaries::Bt2020);
        assert_eq!(
            desc.luminances,
            Some((t.min_lum, t.max_nits, t.reference_nits))
        );
        assert_eq!(desc.target, Some(t));
    }

    /// SDR's brightness is the display's business, and saying otherwise would
    /// make every ordinary surface claim a volume it does not have.
    #[test]
    fn an_sdr_description_says_nothing_about_luminance() {
        let desc = ImageDescription::srgb();
        assert!(desc.luminances.is_none());
        assert!(desc.target.is_none());
    }

    /// A display cannot sustain its peak across the whole panel, so an
    /// override that claims it does is clamped rather than passed on.
    #[test]
    fn full_frame_luminance_never_exceeds_the_peak() {
        let clamped = HdrTarget {
            max_nits: 400,
            max_fall_nits: 4000,
            ..HdrTarget::default()
        }
        .clamped();
        assert_eq!(clamped.max_fall_nits, 400);
        assert_eq!(clamped.max_nits, 400);
    }

    /// The protocol raises `invalid_luminance` on a range that does not go
    /// upwards. nescope is the one sending it, so a bad override has to be
    /// dropped here rather than become a protocol error at the client.
    #[test]
    fn a_range_that_does_not_go_upwards_is_not_sent() {
        let bad = HdrTarget {
            max_nits: 0,
            ..HdrTarget::default()
        };
        assert!(!bad.is_usable());
        assert!(ImageDescription::bt2020_pq(bad).luminances.is_none());
        assert!(ImageDescription::bt2020_pq(bad).target.is_none());
    }
}
