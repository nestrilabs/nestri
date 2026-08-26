//! Generated Wayland protocol bindings for the gamescope swapchain protocol.

#![allow(non_upper_case_globals, non_camel_case_types, unused)]

use smithay::reexports::wayland_server;
use wayland_server::protocol::*;

pub mod __interfaces {
    use super::wayland_server;
    use wayland_server::backend as wayland_backend;
    use wayland_server::protocol::__interfaces::*;
    wayland_scanner::generate_interfaces!("src/protocols/gamescope-swapchain.xml");
}

use self::__interfaces::*;
wayland_scanner::generate_server_code!("src/protocols/gamescope-swapchain.xml");
