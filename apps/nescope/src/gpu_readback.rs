//! Copying a GPU buffer back to the CPU, so a screenshot is not limited to
//! clients that render in software.
//!
//! nescope hands dmabuf straight through to `nescapture` and never looks at it,
//! which is right for a game and useless for everything else. XWayland with
//! glamor — which is every XWayland smithay spawns, since it passes no
//! `-noglamor` — always presents dmabuf, so a Steam client under XWayland was
//! unreadable by construction.
//!
//! This imports such a buffer as a texture and copies it back. It is the only
//! GPU work nescope does, and it is deliberately not compositing: one buffer
//! in, one image out, no output, no swapchain, no presentation.
//!
//! # Why the renderer is created lazily and kept
//!
//! Building an EGL context costs enough to notice, and a login screen is polled
//! every second or so. Building one per capture would spend most of the poll
//! interval on setup. It is created on the first capture that needs it, so a
//! box that only ever runs games never pays for it at all.
//!
//! Thread-local rather than in `NescopeState`: the compositor is single
//! threaded, `GlesRenderer` is not `Send`, and this keeps a debugging aid out
//! of the state every other part of the compositor passes around.

use std::cell::{Cell, RefCell};
use std::path::PathBuf;

use smithay::backend::allocator::Buffer;
use smithay::backend::allocator::dmabuf::Dmabuf;
use smithay::backend::egl::{EGLContext, EGLDisplay};
use smithay::backend::renderer::gles::GlesRenderer;
use smithay::backend::renderer::{ExportMem, ImportDma};
use smithay::utils::{Point, Rectangle, Size};

thread_local! {
    /// `None` until the first attempt; the inner `None` means the attempt
    /// failed and should not be retried on every poll.
    static RENDERER: RefCell<Option<Option<GlesRenderer>>> = const { RefCell::new(None) };
    /// Whether the reason for a failed read has been said out loud yet.
    static WARNED: Cell<bool> = const { Cell::new(false) };
    /// The render device to import on, from `--render-device`.
    static RENDER_DEVICE: RefCell<Option<PathBuf>> = const { RefCell::new(None) };
}

/// Tell the readback which GPU to use, once, at startup.
///
/// The device cannot be taken from the buffer: a dmabuf handed over by a
/// client carries no `DrmNode` — smithay only fills that in when the
/// compositor put it there, and nescope never does. The operator already names
/// the GPU for the game's sake, so the same answer serves here.
pub fn set_render_device(path: Option<String>) {
    RENDER_DEVICE.with(|d| *d.borrow_mut() = path.map(PathBuf::from));
}

/// The configured render node, or the first one on the system.
///
/// Scanning is a fallback rather than the plan: on a single-GPU box it is
/// right, and on a multi-GPU box picking the wrong one fails at import with a
/// message naming the device, which is better than refusing to try.
fn render_device() -> Result<PathBuf, String> {
    if let Some(path) = RENDER_DEVICE.with(|d| d.borrow().clone()) {
        return Ok(path);
    }
    let mut nodes: Vec<PathBuf> = glob::glob("/dev/dri/renderD*")
        .map_err(|e| format!("could not scan /dev/dri: {e}"))?
        .filter_map(Result::ok)
        .collect();
    nodes.sort();
    nodes
        .into_iter()
        .next()
        .ok_or_else(|| "no render node found in /dev/dri; pass --render-device".to_string())
}

/// Why a read did not happen.
enum ReadError {
    /// The GPU path could not be set up at all. Reported once, at setup.
    Unavailable,
    /// Setup worked and this particular buffer could not be read.
    Failed(String),
}

/// Build a renderer on the configured render device.
fn build_renderer() -> Result<GlesRenderer, String> {
    let path = render_device()?;
    let file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&path)
        .map_err(|e| format!("could not open {}: {e}", path.display()))?;
    let gbm = smithay::backend::allocator::gbm::GbmDevice::new(file)
        .map_err(|e| format!("could not create a GBM device on {}: {e}", path.display()))?;

    // SAFETY: the GBM device stays alive for the life of the display, which
    // lives in the thread-local below for the life of the process.
    let display = unsafe { EGLDisplay::new(gbm) }
        .map_err(|e| format!("could not open an EGL display: {e}"))?;
    let context =
        EGLContext::new(&display).map_err(|e| format!("could not create an EGL context: {e}"))?;
    // SAFETY: the context is current only on this thread, and the renderer is
    // thread-local so it can never be used from another.
    unsafe { GlesRenderer::new(context) }.map_err(|e| format!("could not create a renderer: {e}"))
}

/// Copy a dmabuf back to CPU memory as RGBA8.
///
/// Returns `Err` with something worth printing when the GPU path is not
/// available at all — that is a configuration answer, not a transient one, so
/// the caller should say it rather than retry silently.
fn read_dmabuf(dmabuf: &Dmabuf) -> Result<(u32, u32, Vec<u8>), ReadError> {
    RENDERER.with(|cell| {
        let mut slot = cell.borrow_mut();
        if slot.is_none() {
            match build_renderer() {
                Ok(renderer) => *slot = Some(Some(renderer)),
                Err(e) => {
                    // Remembered as a failure so the next poll does not repeat
                    // the whole EGL setup just to fail the same way.
                    tracing::warn!("GPU readback unavailable: {e}");
                    *slot = Some(None);
                }
            }
        }
        let Some(renderer) = slot.as_mut().and_then(|r| r.as_mut()) else {
            // Already explained at setup; saying it again per capture would
            // report one problem twice in two different words.
            return Err(ReadError::Unavailable);
        };

        let size = dmabuf.size();
        let texture = renderer
            .import_dmabuf(dmabuf, None)
            .map_err(|e| ReadError::Failed(format!("could not import the buffer: {e}")))?;

        let region = Rectangle::new(Point::from((0, 0)), Size::from((size.w, size.h)));
        let mapping = renderer
            .copy_texture(
                &texture,
                region,
                smithay::backend::allocator::Fourcc::Abgr8888,
            )
            .map_err(|e| ReadError::Failed(format!("could not copy the texture back: {e}")))?;
        let bytes = renderer
            .map_texture(&mapping)
            .map_err(|e| ReadError::Failed(format!("could not map the copied texture: {e}")))?;

        Ok((size.w as u32, size.h as u32, bytes.to_vec()))
    })
}

/// Read a `wl_buffer` that is backed by a dmabuf.
///
/// `None` when the buffer is not a dmabuf at all, or when the GPU path is
/// unavailable — the caller has already tried shm, so there is nothing left to
/// distinguish and a failure here means "not readable by any route".
pub fn from_wl_buffer(
    buffer: &smithay::reexports::wayland_server::protocol::wl_buffer::WlBuffer,
) -> Option<crate::screenshot_wire::Capture> {
    let dmabuf = smithay::wayland::dmabuf::get_dmabuf(buffer).ok()?;
    match read_dmabuf(dmabuf) {
        Ok((width, height, rgba)) => Some(crate::screenshot_wire::Capture {
            width,
            height,
            rgba,
        }),
        // Setup already said why, once, and repeating it per capture would
        // report one problem twice in two different words.
        Err(ReadError::Unavailable) => None,
        Err(ReadError::Failed(e)) => {
            // Loudly the first time and quietly afterwards. A capture polled
            // every few hundred milliseconds would otherwise either bury the
            // log or -- at debug level, which is off by default -- never say
            // anything at all, leaving `Unreadable` with no explanation
            // anywhere.
            if !WARNED.with(|w| w.replace(true)) {
                tracing::warn!("GPU readback failed: {e}");
            } else {
                tracing::debug!("GPU readback failed: {e}");
            }
            None
        }
    }
}
