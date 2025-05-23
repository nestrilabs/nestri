use crate::websocket::NestriWebSocket;
use gst::glib;
use gst::subclass::prelude::*;
use gstrswebrtc::signaller::Signallable;
use std::sync::Arc;

mod imp;

glib::wrapper! {
    pub struct NestriSignaller(ObjectSubclass<imp::Signaller>) @implements Signallable;
}

impl NestriSignaller {
    pub fn new(nestri_ws: Arc<NestriWebSocket>, wayland_src: Arc<gst::Element>) -> Self {
        let obj: Self = glib::Object::new();
        obj.imp().set_nestri_ws(nestri_ws);
        obj.imp().set_wayland_src(wayland_src);
        obj
    }
}
impl Default for NestriSignaller {
    fn default() -> Self {
        panic!("Cannot create NestriSignaller without NestriWebSocket");
    }
}
