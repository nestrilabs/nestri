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
//! So the launch environment sets `PROTON_ENABLE_WAYLAND=1` (Proton renders
//! through XWayland otherwise) and `DXVK_HDR=1` (DXVK's dxgi gates HDR exposure
//! on it). Those two are what HDR needs.
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
//! A game that cannot be a Wayland client gets SDR. XWayland runs and is the
//! right thing for those titles -- it is what makes them work at all -- but
//! HDR is not available there without the legacy route above. Nothing about
//! this is fixable from inside this module; it is Mesa's XWayland surface
//! offering no HDR colour space.
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
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Primaries {
    Srgb,
    Bt2020,
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
        }
    }

    pub fn bt2020_pq() -> Self {
        Self {
            transfer_function: TransferFunction::St2084Pq,
            primaries: Primaries::Bt2020,
            max_cll: None,
            max_fall: None,
            mastering_luminance: None,
            mastering_primaries: None,
            white_point: None,
        }
    }

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
    /// Pending (not-yet-committed) image descriptions keyed by surface.
    pending: HashMap<WlSurface, Option<ImageDescription>>,
    /// Committed image descriptions keyed by surface.
    current: HashMap<WlSurface, ImageDescription>,
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

        Self {
            enabled,
            pending: HashMap::new(),
            current: HashMap::new(),
        }
    }

    // ── Pending state ─────────────────────────────────────────────────────

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
                    state
                        .hdr
                        .set_pending(&data.surface, ImageDescription::bt2020_pq());
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
        res.supported_primaries_named(wp_color_manager_v1::Primaries::Srgb);
        res.supported_primaries_named(wp_color_manager_v1::Primaries::Bt2020);
        res.done();
    }
}

impl Dispatch<wp_color_manager_v1::WpColorManagerV1, ()> for NescopeState {
    fn request(
        _: &mut Self,
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
                        desc: ImageDescription::bt2020_pq(),
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
            _ => {}
        }
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
                };
                let r = data_init.init(image_description, ImageDescriptionUserData { desc });
                r.ready(0);
            }
            wp_image_description_creator_params_v1::Request::SetTfNamed { tf } => {
                let tf = match tf.into_result() {
                    Ok(wp_color_manager_v1::TransferFunction::St2084Pq) => {
                        TransferFunction::St2084Pq
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
        _: &mut Self,
        _: &Client,
        _: &wp_image_description_v1::WpImageDescriptionV1,
        request: wp_image_description_v1::Request,
        data: &ImageDescriptionUserData,
        _: &DisplayHandle,
        data_init: &mut DataInit<'_, Self>,
    ) {
        if let wp_image_description_v1::Request::GetInformation { information } = request {
            let info = data_init.init(information, ImageDescriptionInfoData);
            match data.desc.transfer_function {
                TransferFunction::St2084Pq => {
                    info.tf_named(wp_color_manager_v1::TransferFunction::St2084Pq)
                }
                TransferFunction::Gamma22 => {
                    info.tf_named(wp_color_manager_v1::TransferFunction::Gamma22)
                }
            }
            match data.desc.primaries {
                Primaries::Bt2020 => info.primaries_named(wp_color_manager_v1::Primaries::Bt2020),
                Primaries::Srgb => info.primaries_named(wp_color_manager_v1::Primaries::Srgb),
            }
            info.done();
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
                ImageDescription::bt2020_pq()
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
                    ImageDescription::bt2020_pq()
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
