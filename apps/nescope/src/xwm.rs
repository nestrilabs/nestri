//! X11 window manager helpers.
//!
//! The `XwmHandler` implementation lives in `handlers.rs` on `CalloopData`
//! because the `X11Wm` calloop event source dispatches through it.
//!
//! This file is reserved for future X11 atom helpers, window-policy tweaks,
//! or gamescope X11 atom extensions that outgrow the handlers module.
