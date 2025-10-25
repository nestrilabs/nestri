use crate::input::controller::ControllerManager;
use crate::p2p::p2p::NestriConnection;
use gstreamer::glib;
use gstreamer::subclass::prelude::*;
use gstrswebrtc::signaller::Signallable;
use std::sync::Arc;
use tokio::sync::mpsc;

mod imp;

glib::wrapper! {
    pub struct NestriSignaller(ObjectSubclass<imp::Signaller>) @implements Signallable;
}

impl NestriSignaller {
    pub async fn new(
        room: String,
        nestri_conn: NestriConnection,
        wayland_src: Arc<gstreamer::Element>,
        controller_manager: Option<Arc<ControllerManager>>,
        rumble_rx: Option<mpsc::Receiver<(u32, u16, u16, u16, String)>>,
        attach_rx: Option<mpsc::Receiver<crate::proto::proto::ProtoControllerAttach>>,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let obj: Self = glib::Object::new();
        obj.imp().set_stream_room(room);
        obj.imp().set_nestri_connection(nestri_conn).await?;
        obj.imp().set_wayland_src(wayland_src);
        if let Some(controller_manager) = controller_manager {
            obj.imp().set_controller_manager(controller_manager);
        }
        if let Some(rumble_rx) = rumble_rx {
            obj.imp().set_rumble_rx(rumble_rx).await;
        }
        if let Some(attach_rx) = attach_rx {
            obj.imp().set_attach_rx(attach_rx).await;
        }
        Ok(obj)
    }
}
impl Default for NestriSignaller {
    fn default() -> Self {
        panic!("Cannot create NestriSignaller without NestriConnection and WaylandSrc");
    }
}
