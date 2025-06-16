use crate::p2p::p2p::NestriConnection;
use gstreamer::glib;
use gstreamer::subclass::prelude::*;
use gstrswebrtc::signaller::Signallable;
use std::sync::Arc;

mod imp;

glib::wrapper! {
    pub struct NestriSignaller(ObjectSubclass<imp::Signaller>) @implements Signallable;
}

impl NestriSignaller {
    pub async fn new(
        room: String,
        nestri_conn: NestriConnection,
        wayland_src: Arc<gstreamer::Element>,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let obj: Self = glib::Object::new();
        obj.imp().set_stream_room(room);
        obj.imp().set_nestri_connection(nestri_conn).await?;
        obj.imp().set_wayland_src(wayland_src);
        Ok(obj)
    }
}
impl Default for NestriSignaller {
    fn default() -> Self {
        panic!("Cannot create NestriSignaller without NestriConnection and WaylandSrc");
    }
}
