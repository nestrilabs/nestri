//! Every controller plugged into the box, by the client and slot it came from.
//!
//! A controller is backed one of two ways, matching the two ways the client
//! sends one (see `nesprotocol::gamepad`): a uinput device built from a
//! positional snapshot, or a uhid device recreated from the real one's own
//! descriptor and reports.

use std::collections::{HashMap, HashSet};
use std::os::fd::{AsRawFd, RawFd};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use nesprotocol::gamepad::{HidDevice, PadFeedback, PadIdentity, PadMessage};
use tokio::io::unix::AsyncFd;
use tokio::sync::mpsc::UnboundedSender;
use tracing::{debug, info, trace, warn};

use crate::layout::{self, Layout};
use crate::udev::{Record, Udev};
use crate::uhid;
use crate::uinput::{Device, Request, Spec};

/// Controllers across every client at once.
///
/// Not a limit anyone should meet: well past what any game expects to see, and
/// there so that one that has misbehaved cannot fill the box with devices.
pub const MAX_PADS: usize = 16;

/// A client's slot. The session is the hub's number for the client.
pub type Key = (u32, u8);

/// Feedback for one client.
pub type Feedback = (u32, PadFeedback);

/// Something a uhid device's own task has for the manager.
#[derive(Debug)]
pub enum HidNotice {
    Kernel(uhid::Event),
    /// Look for the device's nodes again. They appear after the kernel says
    /// the device started, not with it.
    Discover {
        attempt: u32,
    },
}

/// How often, and for how long, to look for a started device's nodes.
const DISCOVER_EVERY: Duration = Duration::from_millis(20);
const DISCOVER_ATTEMPTS: u32 = 50;

/// Requests the real device has not answered yet are kept to know how to
/// answer; past this many, the oldest were never going to be.
const PENDING_MAX: usize = 64;

enum Backend {
    Gamepad {
        device: Arc<Device>,
        layout: Layout,
        identity: PadIdentity,
    },
    Hid {
        device: Arc<uhid::Device>,
        announced: HidDevice,
        /// The kernel's directory for it, once found.
        syspath: Option<PathBuf>,
        /// Requests passed to the client, by id: `true` for a read.
        pending: HashMap<u32, bool>,
    },
}

struct Pad {
    backend: Backend,
    /// The devices announced for it, parents first.
    records: Vec<Record>,
    /// Reads the device for what games ask of it. Stopped before the device
    /// goes.
    task: tokio::task::JoinHandle<()>,
    /// Whether any input has arrived for it yet.
    ///
    /// Said once, at info: from a log alone, a controller that is plugged in
    /// and never moves is otherwise indistinguishable from one whose input
    /// reaches a device no game is reading.
    moved: bool,
}

impl Pad {
    fn name(&self) -> &str {
        match &self.backend {
            Backend::Gamepad { layout, .. } => &layout.name,
            Backend::Hid { announced, .. } => &announced.identity.name,
        }
    }
}

pub struct Pads {
    udev: Option<Udev>,
    pads: HashMap<Key, Pad>,
    /// Slots already asked to re-announce, so input arriving for one the box
    /// does not have asks once rather than once per report.
    asked: HashSet<Key>,
    feedback: UnboundedSender<Feedback>,
    hid: UnboundedSender<(Key, HidNotice)>,
}

impl Pads {
    pub fn new(
        udev: Option<Udev>,
        feedback: UnboundedSender<Feedback>,
        hid: UnboundedSender<(Key, HidNotice)>,
    ) -> Self {
        Self {
            udev,
            pads: HashMap::new(),
            asked: HashSet::new(),
            feedback,
            hid,
        }
    }

    pub fn handle(&mut self, session: u32, message: PadMessage) {
        match message {
            PadMessage::Connect { slot, identity } => self.connect((session, slot), identity),
            PadMessage::HidConnect { slot, device } => self.connect_hid((session, slot), device),
            PadMessage::State { slot, state } => {
                let key = (session, slot);
                let Some(pad) = self.present(key) else { return };
                trace!(session, slot, ?state, "state");
                let Backend::Gamepad { device, layout, .. } = &pad.backend else {
                    debug!(session, slot, "gamepad state for a forwarded device");
                    return;
                };
                if let Err(e) = device.write(&layout.events(&state)) {
                    // Per state, so debug: a device that stopped taking writes
                    // fails every one of them.
                    debug!(session, slot, "could not write to the device: {e}");
                }
            }
            PadMessage::HidInput { slot, report } => {
                let key = (session, slot);
                let Some(pad) = self.present(key) else { return };
                trace!(session, slot, len = report.len(), "report");
                let Backend::Hid { device, .. } = &pad.backend else {
                    debug!(session, slot, "a report for a gamepad");
                    return;
                };
                if let Err(e) = device.input(&report) {
                    debug!(session, slot, "could not write a report: {e}");
                }
            }
            PadMessage::HidReply {
                slot,
                id,
                err,
                data,
            } => {
                let Some(pad) = self.pads.get_mut(&(session, slot)) else {
                    return;
                };
                let Backend::Hid {
                    device, pending, ..
                } = &mut pad.backend
                else {
                    return;
                };
                let result = match pending.remove(&id) {
                    Some(true) => device.get_report_reply(id, err, &data),
                    Some(false) => device.set_report_reply(id, err),
                    // Answered too late: the kernel gave up on it already.
                    None => return,
                };
                if let Err(e) = result {
                    debug!(session, slot, id, "could not answer a request: {e}");
                }
            }
            PadMessage::Disconnect { slot } => self.remove((session, slot)),
            PadMessage::SessionEnd => self.end_session(session),
        }
    }

    /// The pad in `key`, noting its first input, or asking the client to
    /// announce it when there is none.
    fn present(&mut self, key: Key) -> Option<&mut Pad> {
        let (session, slot) = key;
        if !self.pads.contains_key(&key) {
            if self.asked.insert(key) {
                debug!(
                    session,
                    slot, "input for a controller not here; asking for it"
                );
                let _ = self
                    .feedback
                    .send((session, PadFeedback::Announce { slot }));
            }
            return None;
        }
        let pad = self.pads.get_mut(&key)?;
        if !pad.moved {
            pad.moved = true;
            info!(session, slot, "first input from the controller");
        }
        Some(pad)
    }

    /// Room for one more in `key`, replacing whatever was there. `false` when
    /// the box is full.
    fn make_room(&mut self, key: Key, name: &str) -> bool {
        self.asked.remove(&key);
        self.remove(key);
        if self.pads.len() >= MAX_PADS {
            warn!(
                session = key.0,
                slot = key.1,
                "{MAX_PADS} controllers are already plugged in; not adding \"{name}\""
            );
            return false;
        }
        true
    }

    fn connect(&mut self, key: Key, identity: PadIdentity) {
        let (session, slot) = key;
        if let Some(Pad {
            backend: Backend::Gamepad { identity: have, .. },
            ..
        }) = self.pads.get(&key)
            && *have == identity
        {
            // A re-announce of what is already here, which a client does
            // after asking and is harmless.
            return;
        }
        if !self.make_room(key, &identity.name) {
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
                let task = spawn_rumble(device.clone(), session, slot, self.feedback.clone());
                self.pads.insert(
                    key,
                    Pad {
                        backend: Backend::Gamepad {
                            device,
                            layout,
                            identity,
                        },
                        records,
                        task,
                        moved: false,
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
        open_up(&Path::new("/dev/input").join(event.file_name().unwrap()));

        let extra = classification(layout, key);
        let records = vec![
            Record::read(&syspath, "input", &extra)?,
            Record::read(&event, "input", &extra)?,
        ];
        self.announce(&records)?;
        Ok((Arc::new(device), records))
    }

    fn announce(&self, records: &[Record]) -> std::io::Result<()> {
        match &self.udev {
            Some(udev) => {
                for record in records {
                    udev.add(record)?;
                }
            }
            None => debug!("no udev stand-in; the device exists but nothing is told"),
        }
        Ok(())
    }

    fn connect_hid(&mut self, key: Key, device: HidDevice) {
        let (session, slot) = key;
        if let Some(Pad {
            backend: Backend::Hid { announced, .. },
            ..
        }) = self.pads.get(&key)
            && *announced == device
        {
            return;
        }
        if !self.make_room(key, &device.identity.name) {
            return;
        }
        let identity = &device.identity;
        let created = uhid::Device::create(&uhid::Spec {
            name: &identity.name,
            uniq: &device.uniq,
            bus: identity.bus,
            vendor: identity.vendor,
            product: identity.product,
            version: identity.version,
            country: device.country,
            descriptor: &device.descriptor,
        });
        let created = match created {
            Ok(created) => Arc::new(created),
            Err(e) => {
                warn!(
                    session,
                    slot, "could not create a HID device for \"{}\": {e}", identity.name
                );
                return;
            }
        };
        info!(
            session,
            slot,
            name = identity.name,
            id = format!(
                "{:04x}:{:04x}:{:04x} bus {:#04x}",
                identity.vendor, identity.product, identity.version, identity.bus
            ),
            descriptor = device.descriptor.len(),
            "controller plugged in as itself"
        );
        let task = spawn_hid(created.clone(), key, self.hid.clone());
        self.pads.insert(
            key,
            Pad {
                backend: Backend::Hid {
                    device: created,
                    announced: device,
                    syspath: None,
                    pending: HashMap::new(),
                },
                records: Vec::new(),
                task,
                moved: false,
            },
        );
    }

    /// Something a uhid device's task passed on.
    pub fn hid_notice(&mut self, key: Key, notice: HidNotice) {
        let (session, slot) = key;
        if !self.pads.contains_key(&key) {
            // Unplugged since the task said it; nothing is waiting on it.
            return;
        }
        let request = match notice {
            HidNotice::Kernel(uhid::Event::Start) => {
                debug!(session, slot, "a driver took the device");
                self.schedule_discovery(key, 0);
                return;
            }
            HidNotice::Discover { attempt } => {
                self.discover_nodes(key, attempt);
                return;
            }
            HidNotice::Kernel(uhid::Event::Stop) => {
                debug!(session, slot, "the driver let go of the device");
                return;
            }
            HidNotice::Kernel(uhid::Event::Open | uhid::Event::Close) => return,
            HidNotice::Kernel(uhid::Event::Output { kind, data }) => {
                trace!(session, slot, kind, len = data.len(), "output report");
                PadFeedback::HidOutput { slot, kind, data }
            }
            HidNotice::Kernel(uhid::Event::GetReport { id, number, kind }) => {
                trace!(session, slot, id, number, kind, "get report");
                self.remember(key, id, true);
                PadFeedback::HidGetReport {
                    slot,
                    id,
                    number,
                    kind,
                }
            }
            HidNotice::Kernel(uhid::Event::SetReport {
                id,
                number,
                kind,
                data,
            }) => {
                trace!(session, slot, id, number, kind, "set report");
                self.remember(key, id, false);
                PadFeedback::HidSetReport {
                    slot,
                    id,
                    number,
                    kind,
                    data,
                }
            }
        };
        let _ = self.feedback.send((session, request));
    }

    /// Note a request passed to the client, to know how to answer it.
    fn remember(&mut self, key: Key, id: u32, read: bool) {
        let Some(Pad {
            backend: Backend::Hid { pending, .. },
            ..
        }) = self.pads.get_mut(&key)
        else {
            return;
        };
        if pending.len() >= PENDING_MAX {
            // Ids count up, so the smallest are the oldest.
            if let Some(&oldest) = pending.keys().min() {
                pending.remove(&oldest);
            }
        }
        pending.insert(id, read);
    }

    fn discover_nodes(&mut self, key: Key, attempt: u32) {
        let (session, slot) = key;
        let Some(Pad {
            backend:
                Backend::Hid {
                    announced,
                    syspath: None,
                    ..
                },
            ..
        }) = self.pads.get(&key)
        else {
            return;
        };
        let announced = announced.clone();
        let claimed: HashSet<PathBuf> = self
            .pads
            .values()
            .filter_map(|p| match &p.backend {
                Backend::Hid { syspath, .. } => syspath.clone(),
                Backend::Gamepad { .. } => None,
            })
            .collect();
        match discover(&announced, &claimed) {
            Some((found, nodes)) => self.nodes_found(key, found, nodes),
            None if attempt + 1 < DISCOVER_ATTEMPTS => self.schedule_discovery(key, attempt + 1),
            None => warn!(
                session,
                slot,
                "the kernel made no nodes for \"{}\", so nothing can read it",
                announced.identity.name
            ),
        }
    }

    fn schedule_discovery(&self, key: Key, attempt: u32) {
        let tx = self.hid.clone();
        tokio::spawn(async move {
            if attempt > 0 {
                tokio::time::sleep(DISCOVER_EVERY).await;
            }
            let _ = tx.send((key, HidNotice::Discover { attempt }));
        });
    }

    fn nodes_found(&mut self, key: Key, found: PathBuf, nodes: Nodes) {
        let (session, slot) = key;
        for node in nodes.dev_nodes() {
            open_up(&node);
        }
        let mut records = Vec::new();
        let joystick = [
            ("ID_INPUT", "1".to_owned()),
            ("ID_INPUT_JOYSTICK", "1".to_owned()),
        ];
        let mut read = |path: &Path, subsystem: &str, extra: &[(&str, String)]| match Record::read(
            path, subsystem, extra,
        ) {
            Ok(record) => records.push(record),
            Err(e) => debug!("could not describe {}: {e}", path.display()),
        };
        for hidraw in &nodes.hidraw {
            read(hidraw, "hidraw", &[]);
        }
        for (input, events) in &nodes.inputs {
            read(input, "input", &joystick);
            for event in events {
                read(event, "input", &joystick);
            }
        }
        if let Err(e) = self.announce(&records) {
            warn!(session, slot, "could not announce the device: {e}");
        }
        info!(
            session,
            slot,
            nodes = nodes
                .dev_nodes()
                .iter()
                .map(|p| p.display().to_string())
                .collect::<Vec<_>>()
                .join(" "),
            "controller nodes ready"
        );
        if let Some(pad) = self.pads.get_mut(&key) {
            pad.records = records;
            if let Backend::Hid { syspath, .. } = &mut pad.backend {
                *syspath = Some(found);
            }
        }
    }

    fn remove(&mut self, key: Key) {
        let Some(pad) = self.pads.remove(&key) else {
            return;
        };
        pad.task.abort();
        // Destroyed explicitly, before anyone is told it is gone. Dropping the
        // handle would not do it: the aborted task holds another, and lets go
        // of it only when the runtime next gets round to dropping the task.
        match &pad.backend {
            Backend::Gamepad { device, .. } => device.destroy(),
            Backend::Hid { device, .. } => device.destroy(),
        }
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
            pad.name()
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

/// Open a node to the workload.
///
/// devtmpfs creates it root-only, and the workload is not root. `nesinit`
/// opens up the box's other device nodes the same way, for the same reason:
/// the virtual machine is the boundary.
///
/// A failure is a warning rather than no controller: the device still exists,
/// a workload running as root can still use it, and the line says why one
/// that is not cannot.
fn open_up(node: &Path) {
    if let Err(e) =
        std::fs::set_permissions(node, std::os::unix::fs::PermissionsExt::from_mode(0o666))
    {
        warn!(
            "could not open up {} to the workload, so only root can read this controller: {e}",
            node.display()
        );
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

/// Where uhid devices appear in sysfs.
const UHID_SYSFS: &str = "/sys/devices/virtual/misc/uhid";

/// The nodes a driver made for one HID device, as sysfs paths.
#[derive(Debug, Default)]
pub(crate) struct Nodes {
    pub(crate) hidraw: Vec<PathBuf>,
    /// Each input device, with its event nodes.
    inputs: Vec<(PathBuf, Vec<PathBuf>)>,
}

impl Nodes {
    fn dev_nodes(&self) -> Vec<PathBuf> {
        let dev =
            |path: &PathBuf, dir: &str| Path::new(dir).join(path.file_name().unwrap_or_default());
        let mut nodes: Vec<PathBuf> = self.hidraw.iter().map(|h| dev(h, "/dev")).collect();
        for (_, events) in &self.inputs {
            nodes.extend(events.iter().map(|e| dev(e, "/dev/input")));
        }
        nodes
    }
}

/// Find the kernel's directory for a device made from `announced`, and what
/// was made under it -- `None` until the hidraw node exists, which is the node
/// that matters.
///
/// The kernel names the directory `BUS:VENDOR:PRODUCT.INSTANCE`, and several
/// devices can share everything but the instance, so one already claimed by
/// another controller is skipped. Two identical devices started at the same
/// moment could be found the other way round, which costs nothing: the same
/// nodes are opened up and announced either way.
pub(crate) fn discover(
    announced: &HidDevice,
    claimed: &HashSet<PathBuf>,
) -> Option<(PathBuf, Nodes)> {
    let prefix = format!(
        "{:04X}:{:04X}:{:04X}.",
        announced.identity.bus, announced.identity.vendor, announced.identity.product
    );
    let mut candidates: Vec<PathBuf> = std::fs::read_dir(UHID_SYSFS)
        .ok()?
        .filter_map(Result::ok)
        .filter(|e| e.file_name().to_string_lossy().starts_with(&prefix))
        .map(|e| e.path())
        .filter(|p| !claimed.contains(p))
        .collect();
    candidates.sort();
    // The newest first: instances count up.
    let dir = candidates.pop()?;
    let nodes = nodes_under(&dir);
    if nodes.hidraw.is_empty() {
        return None;
    }
    Some((dir, nodes))
}

fn nodes_under(dir: &Path) -> Nodes {
    let children = |path: &Path, prefix: &str| -> Vec<PathBuf> {
        let mut found: Vec<PathBuf> = std::fs::read_dir(path)
            .into_iter()
            .flatten()
            .filter_map(Result::ok)
            .filter(|e| e.file_name().to_string_lossy().starts_with(prefix))
            .map(|e| e.path())
            .collect();
        found.sort();
        found
    };
    let mut nodes = Nodes {
        hidraw: children(&dir.join("hidraw"), "hidraw"),
        ..Nodes::default()
    };
    for input in children(&dir.join("input"), "input") {
        let events = children(&input, "event");
        nodes.inputs.push((input, events));
    }
    nodes
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

/// A descriptor, for the reactor.
struct Readable<T>(Arc<T>);

impl<T: AsRawFd> AsRawFd for Readable<T> {
    fn as_raw_fd(&self) -> RawFd {
        self.0.as_raw_fd()
    }
}

/// Pass everything a uhid device's kernel side says to the manager.
fn spawn_hid(
    device: Arc<uhid::Device>,
    key: Key,
    tx: UnboundedSender<(Key, HidNotice)>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let fd = match AsyncFd::new(Readable(device)) {
            Ok(fd) => fd,
            Err(e) => {
                warn!(
                    session = key.0,
                    slot = key.1,
                    "cannot hear the device's kernel side: {e}"
                );
                return;
            }
        };
        loop {
            let mut guard = match fd.readable().await {
                Ok(guard) => guard,
                Err(e) => {
                    debug!(
                        session = key.0,
                        slot = key.1,
                        "device stopped being readable: {e}"
                    );
                    return;
                }
            };
            let events = match guard.get_inner().0.drain() {
                Ok(events) => events,
                Err(e) => {
                    debug!(
                        session = key.0,
                        slot = key.1,
                        "reading the device failed: {e}"
                    );
                    return;
                }
            };
            guard.clear_ready();
            for event in events {
                if tx.send((key, HidNotice::Kernel(event))).is_err() {
                    return;
                }
            }
        }
    })
}

/// Read a uinput device for what games ask of it, and turn that into rumble
/// for the client.
///
/// A game uploads an effect once and then plays and stops it by id, so the
/// effects are kept here to know what "play 3" means. Only the most recently
/// started one is sent: a real controller has one pair of motors, and the
/// client has no way to mix several.
fn spawn_rumble(
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
