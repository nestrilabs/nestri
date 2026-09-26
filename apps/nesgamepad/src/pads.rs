//! Every controller plugged into the box, by the client and slot it came from.

use std::collections::{HashMap, HashSet};
use std::os::fd::{AsRawFd, RawFd};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use nesprotocol::gamepad::{PadFeedback, PadIdentity, PadMessage};
use tokio::io::unix::AsyncFd;
use tokio::sync::mpsc::UnboundedSender;
use tracing::{debug, info, trace, warn};

use crate::layout::{self, Layout};
use crate::udev::{Record, Udev};
use crate::uinput::{Device, Request, Spec};

/// Controllers across every client at once.
///
/// Not a limit anyone should meet: well past what any game expects to see, and
/// there so that one that has misbehaved cannot fill the box with devices.
pub const MAX_PADS: usize = 16;

/// A client's slot. The session is the hub's number for the client.
type Key = (u32, u8);

/// Feedback for one client.
pub type Feedback = (u32, PadFeedback);

struct Pad {
    device: Arc<Device>,
    layout: Layout,
    identity: PadIdentity,
    /// The input device and its event node, parent first, as announced.
    records: Vec<Record>,
    /// Reads the device for rumble. Stopped before the device goes.
    feedback: tokio::task::JoinHandle<()>,
}

pub struct Pads {
    udev: Option<Udev>,
    pads: HashMap<Key, Pad>,
    /// Slots already asked to re-announce, so state arriving for one the box
    /// does not have asks once rather than once per state.
    asked: HashSet<Key>,
    feedback: UnboundedSender<Feedback>,
}

impl Pads {
    pub fn new(udev: Option<Udev>, feedback: UnboundedSender<Feedback>) -> Self {
        Self {
            udev,
            pads: HashMap::new(),
            asked: HashSet::new(),
            feedback,
        }
    }

    pub fn handle(&mut self, session: u32, message: PadMessage) {
        match message {
            PadMessage::Connect { slot, identity } => self.connect((session, slot), identity),
            PadMessage::State { slot, state } => {
                let key = (session, slot);
                let Some(pad) = self.pads.get(&key) else {
                    if self.asked.insert(key) {
                        debug!(
                            session,
                            slot, "state for a controller not here; asking for it"
                        );
                        let _ = self
                            .feedback
                            .send((session, PadFeedback::Announce { slot }));
                    }
                    return;
                };
                trace!(session, slot, ?state, "state");
                if let Err(e) = pad.device.write(&pad.layout.events(&state)) {
                    // Per state, so debug: a device that stopped taking writes
                    // fails every one of them.
                    debug!(session, slot, "could not write to the device: {e}");
                }
            }
            PadMessage::Disconnect { slot } => self.remove((session, slot)),
            PadMessage::SessionEnd => self.end_session(session),
        }
    }

    fn connect(&mut self, key: Key, identity: PadIdentity) {
        let (session, slot) = key;
        self.asked.remove(&key);
        if let Some(pad) = self.pads.get(&key) {
            if pad.identity == identity {
                // A re-announce of what is already here, which a client does
                // after asking and is harmless.
                return;
            }
            self.remove(key);
        }
        if self.pads.len() >= MAX_PADS {
            warn!(
                session,
                slot,
                "{MAX_PADS} controllers are already plugged in; not adding \"{}\"",
                identity.name
            );
            return;
        }
        let layout = layout::for_identity(&identity);
        match self.plug(key, &layout) {
            Ok((device, records)) => {
                info!(
                    session,
                    slot,
                    client_name = identity.name,
                    client_id = format!(
                        "{:04x}:{:04x}:{:04x} bus {:#04x}",
                        identity.vendor, identity.product, identity.version, identity.bus
                    ),
                    driver = layout.driver,
                    device = format!(
                        "{} {:04x}:{:04x}:{:04x}",
                        layout.name, layout.vendor, layout.product, layout.version
                    ),
                    node = records
                        .last()
                        .and_then(|r| r.properties.get("DEVNAME"))
                        .map(String::as_str)
                        .unwrap_or("none"),
                    "controller plugged in"
                );
                let feedback = spawn_feedback(device.clone(), session, slot, self.feedback.clone());
                self.pads.insert(
                    key,
                    Pad {
                        device,
                        layout,
                        identity,
                        records,
                        feedback,
                    },
                );
            }
            Err(e) => warn!(
                session,
                slot, "could not create a device for \"{}\": {e:#}", identity.name
            ),
        }
    }

    fn plug(&self, key: Key, layout: &Layout) -> anyhow::Result<(Arc<Device>, Vec<Record>)> {
        let keys: Vec<u16> = layout.buttons.iter().map(|&(_, key)| key).collect();
        let device = Device::create(&Spec {
            name: &layout.name,
            bus: layout.bus,
            vendor: layout.vendor,
            product: layout.product,
            version: layout.version,
            keys: &keys,
            axes: &layout.axes(),
        })?;
        let syspath = device.syspath();
        let event = event_node(&syspath)?;

        // The node is root-only as devtmpfs creates it, and the workload is
        // not root. `nesinit` opens up the box's other device nodes the same
        // way, for the same reason: the virtual machine is the boundary.
        //
        // A failure is a warning rather than no controller: the device still
        // exists, a workload running as root can still use it, and the line
        // says why one that is not cannot.
        let devname = Path::new("/dev/input").join(event.file_name().unwrap());
        if let Err(e) = std::fs::set_permissions(
            &devname,
            std::os::unix::fs::PermissionsExt::from_mode(0o666),
        ) {
            warn!(
                "could not open up {} to the workload, so only root can read this controller: {e}",
                devname.display()
            );
        }

        let extra = classification(layout, key);
        let records = vec![
            Record::read(&syspath, &extra)?,
            Record::read(&event, &extra)?,
        ];
        match &self.udev {
            Some(udev) => {
                for record in &records {
                    udev.add(record)?;
                }
            }
            None => debug!("no udev stand-in; the device exists but nothing is told"),
        }
        Ok((Arc::new(device), records))
    }

    fn remove(&mut self, key: Key) {
        let Some(pad) = self.pads.remove(&key) else {
            return;
        };
        pad.feedback.abort();
        // Destroyed explicitly, before anyone is told it is gone. Dropping the
        // handle would not do it: the aborted task holds another, and lets go
        // of it only when the runtime next gets round to dropping the task.
        pad.device.destroy();
        if let Some(udev) = &self.udev {
            for record in pad.records.iter().rev() {
                if let Err(e) = udev.remove(record) {
                    debug!("could not announce {} gone: {e}", record.devpath);
                }
            }
        }
        info!(
            session = key.0,
            slot = key.1,
            "controller unplugged: {}",
            pad.layout.name
        );
    }

    fn end_session(&mut self, session: u32) {
        let keys: Vec<Key> = self
            .pads
            .keys()
            .filter(|k| k.0 == session)
            .copied()
            .collect();
        for key in keys {
            self.remove(key);
        }
        self.asked.retain(|k| k.0 != session);
    }

    /// Unplug everything. The hub has gone, and with it every client.
    pub fn clear(&mut self) {
        let keys: Vec<Key> = self.pads.keys().copied().collect();
        for key in keys {
            self.remove(key);
        }
        self.asked.clear();
    }
}

/// The `eventN` node the kernel attached to an input device.
fn event_node(syspath: &Path) -> anyhow::Result<PathBuf> {
    for entry in std::fs::read_dir(syspath)? {
        let entry = entry?;
        if entry.file_name().to_string_lossy().starts_with("event") {
            return Ok(entry.path());
        }
    }
    anyhow::bail!("{} has no event node", syspath.display())
}

/// What udev's rules would have added: that this is a joystick, and, where
/// the device carries a real identity, which one.
fn classification(layout: &Layout, (session, slot): Key) -> Vec<(&'static str, String)> {
    let mut extra = vec![
        ("ID_INPUT", "1".to_owned()),
        ("ID_INPUT_JOYSTICK", "1".to_owned()),
    ];
    if let Some(bus) = layout.udev_bus() {
        let serial = layout.name.replace(' ', "_");
        extra.extend([
            ("ID_BUS", bus.to_owned()),
            ("ID_VENDOR_ID", format!("{:04x}", layout.vendor)),
            ("ID_MODEL_ID", format!("{:04x}", layout.product)),
            // Unique per device, as real serials are, so two identical
            // controllers are not taken for one.
            ("ID_SERIAL", format!("{serial}_{session}_{slot}")),
        ]);
    }
    extra
}

/// The device's descriptor, for the reactor.
struct Readable(Arc<Device>);

impl AsRawFd for Readable {
    fn as_raw_fd(&self) -> RawFd {
        self.0.as_raw_fd()
    }
}

/// Read a device for what games ask of it, and turn that into rumble for the
/// client.
///
/// A game uploads an effect once and then plays and stops it by id, so the
/// effects are kept here to know what "play 3" means. Only the most recently
/// started one is sent: a real controller has one pair of motors, and the
/// client has no way to mix several.
fn spawn_feedback(
    device: Arc<Device>,
    session: u32,
    slot: u8,
    tx: UnboundedSender<Feedback>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let fd = match AsyncFd::new(Readable(device)) {
            Ok(fd) => fd,
            Err(e) => {
                warn!(session, slot, "rumble unavailable: {e}");
                return;
            }
        };
        let mut effects: HashMap<i16, (u16, u16, u16)> = HashMap::new();
        let mut playing: Option<i16> = None;
        let send = |strong, weak, duration_ms| {
            let _ = tx.send((
                session,
                PadFeedback::Rumble {
                    slot,
                    strong,
                    weak,
                    duration_ms,
                },
            ));
        };
        loop {
            let mut guard = match fd.readable().await {
                Ok(guard) => guard,
                Err(e) => {
                    debug!(session, slot, "device stopped being readable: {e}");
                    return;
                }
            };
            let requests = match guard.get_inner().0.drain() {
                Ok(requests) => requests,
                Err(e) => {
                    debug!(session, slot, "reading the device failed: {e}");
                    return;
                }
            };
            guard.clear_ready();
            for request in requests {
                trace!(session, slot, ?request, "from a game");
                match request {
                    Request::Upload(effect) => {
                        let Some((strong, weak)) = effect.rumble() else {
                            continue;
                        };
                        let length = effect.length_ms();
                        effects.insert(effect.id, (strong, weak, length));
                        // Replacing the effect that is playing changes what
                        // the motors are doing now, not only next time.
                        if playing == Some(effect.id) {
                            send(strong, weak, length);
                        }
                    }
                    Request::Erase(id) => {
                        effects.remove(&id);
                        if playing == Some(id) {
                            playing = None;
                            send(0, 0, 0);
                        }
                    }
                    Request::Play { id, on: true } => {
                        if let Some(&(strong, weak, length)) = effects.get(&id) {
                            playing = Some(id);
                            send(strong, weak, length);
                        }
                    }
                    Request::Play { id, on: false } => {
                        if playing == Some(id) {
                            playing = None;
                            send(0, 0, 0);
                        }
                    }
                }
            }
        }
    })
}
