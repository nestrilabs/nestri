//! Every controller plugged into the box, by the client and slot it came from.
//!
//! The client only ever describes a controller; what a game finds for it is
//! decided here, in one of two ways:
//!
//! - **A family the box can rebuild** (see `crate::replica`) becomes the device
//!   itself, through uhid, for games that read the device and parse its
//!   reports. Beside it goes a gamepad under a neutral identity, for games
//!   that read only XInput: Proton gives XInput only to controllers it reads
//!   through SDL, and drops such a controller when a raw device with the same
//!   vendor and product exists, so the copy survives only without them -- and
//!   without them, no game that recognises the family by those numbers
//!   mistakes the copy for the device. Games that offer both ways of reading a
//!   controller use one at a time, so a press is never answered twice.
//! - **Anything else** becomes one uinput gamepad, laid out the way the Linux
//!   driver for its identity would lay it out (see `crate::layout`).

use std::collections::{HashMap, HashSet};
use std::os::fd::{AsRawFd, RawFd};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use nesprotocol::gamepad::{PadFeedback, PadIdentity, PadMessage, PadState};
use tokio::io::unix::AsyncFd;
use tokio::sync::mpsc::UnboundedSender;
use tracing::{debug, info, trace, warn};

use crate::layout::{self, Layout};
use crate::replica::{self, Model, Reporter};
use crate::template::{self, Template};
use crate::udev::{Record, Udev};
use crate::uhid;
use crate::uinput::{Device, Request, Spec, code};

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

/// A uinput device.
struct Gamepad {
    device: Arc<Device>,
    layout: Layout,
    /// The devices announced for it, parents first.
    records: Vec<Record>,
    /// Reads the device for rumble. Stopped before the device goes.
    task: tokio::task::JoinHandle<()>,
}

/// A device rebuilt as itself.
struct Replica {
    model: Model,
    vendor: u16,
    product: u16,
    device: Arc<uhid::Device>,
    address: [u8; 6],
    reporter: Arc<Mutex<Reporter>>,
    /// The kernel's directory for it, once found.
    syspath: Option<PathBuf>,
    records: Vec<Record>,
    /// Hears the kernel side, and keeps the reports coming. Stopped before
    /// the device goes.
    tasks: [tokio::task::JoinHandle<()>; 2],
    /// The rumble last passed on. Games write the report that carries it for
    /// the lights as well, often, and only a change is worth sending.
    rumble: (u16, u16),
}

struct Pad {
    identity: PadIdentity,
    replica: Option<Replica>,
    gamepad: Option<Gamepad>,
    /// Whether any input has arrived for it yet.
    ///
    /// Said once, at info: from a log alone, a controller that is plugged in
    /// and never moves is otherwise indistinguishable from one whose input
    /// reaches a device no game is reading.
    moved: bool,
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
            PadMessage::State { slot, state } => self.state((session, slot), state),
            PadMessage::Disconnect { slot } => self.remove((session, slot)),
            PadMessage::SessionEnd => self.end_session(session),
        }
    }

    fn state(&mut self, key: Key, state: PadState) {
        let (session, slot) = key;
        let Some(pad) = self.present(key) else { return };
        trace!(session, slot, ?state, "state");
        if let Some(replica) = &pad.replica {
            // Now rather than at the next tick of its clock, which would add
            // up to a tick of latency to every press.
            let report = {
                let mut reporter = replica.reporter.lock().unwrap_or_else(|e| e.into_inner());
                reporter.set(state);
                reporter.next()
            };
            if let Err(e) = replica.device.input(&report) {
                // Per state, so debug: a device that stopped taking writes
                // fails every one of them.
                debug!(session, slot, "could not write a report: {e}");
            }
        }
        if let Some(gamepad) = &pad.gamepad
            && let Err(e) = gamepad.device.write(&gamepad.layout.events(&state))
        {
            debug!(session, slot, "could not write to the device: {e}");
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

    fn connect(&mut self, key: Key, identity: PadIdentity) {
        let (session, slot) = key;
        if self
            .pads
            .get(&key)
            .is_some_and(|pad| pad.identity == identity)
        {
            // A re-announce of what is already here, which a client does
            // after asking and is harmless.
            return;
        }
        self.asked.remove(&key);
        self.remove(key);
        if self.pads.len() >= MAX_PADS {
            warn!(
                session,
                slot,
                "{MAX_PADS} controllers are already plugged in; not adding \"{}\"",
                identity.name
            );
            return;
        }
        info!(
            session,
            slot,
            name = identity.name,
            id = format!("{:04x}:{:04x}", identity.vendor, identity.product),
            "controller connected"
        );
        let mut pad = Pad {
            identity,
            replica: None,
            gamepad: None,
            moved: false,
        };
        let template = template::for_identity(&pad.identity);
        debug!(
            session,
            slot,
            template = template.describe(),
            "template chosen"
        );
        match template {
            // Its gamepad follows once its own nodes exist, so that a game
            // settling on the first controller it finds finds the device.
            Template::Replica { model, product } => match self.rebuild(key, model, product) {
                Ok(replica) => pad.replica = Some(replica),
                Err(e) => {
                    warn!(
                        session,
                        slot,
                        "could not rebuild \"{}\" as itself, so it goes as a gamepad alone: {e}",
                        pad.identity.name
                    );
                    pad.gamepad = self.plug(key, layout::generic(&pad.identity));
                }
            },
            Template::Gamepad(layout) => pad.gamepad = self.plug(key, layout),
        }
        self.pads.insert(key, pad);
    }

    fn rebuild(&self, key: Key, model: Model, product: u16) -> std::io::Result<Replica> {
        let (session, slot) = key;
        let address = replica::address(session, slot);
        let uniq = replica::uniq(address);
        let spec = model.spec(product, &uniq);
        let device = Arc::new(uhid::Device::create(&spec)?);
        info!(
            session,
            slot,
            model = ?model,
            device = format!("{} {:04x}:{:04x}", spec.name, spec.vendor, spec.product),
            "controller plugged in as itself"
        );
        let reporter = Arc::new(Mutex::new(Reporter::new(model)));
        let tasks = [
            spawn_hid(device.clone(), key, self.hid.clone()),
            spawn_clock(device.clone(), reporter.clone(), model.report_every()),
        ];
        Ok(Replica {
            model,
            vendor: spec.vendor,
            product: spec.product,
            device,
            address,
            reporter,
            syspath: None,
            records: Vec::new(),
            tasks,
            rumble: (0, 0),
        })
    }

    /// A uinput device for `key`, or none when it cannot be made -- said, and
    /// the controller left without it.
    fn plug(&self, key: Key, layout: Layout) -> Option<Gamepad> {
        let (session, slot) = key;
        match self.make_gamepad(key, &layout) {
            Ok((device, records)) => {
                info!(
                    session,
                    slot,
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
                    "controller plugged in as a gamepad"
                );
                let task = spawn_rumble(device.clone(), session, slot, self.feedback.clone());
                Some(Gamepad {
                    device,
                    layout,
                    records,
                    task,
                })
            }
            Err(e) => {
                warn!(
                    session,
                    slot, "could not create a gamepad for \"{}\": {e:#}", layout.name
                );
                None
            }
        }
    }

    fn make_gamepad(
        &self,
        key: Key,
        layout: &Layout,
    ) -> anyhow::Result<(Arc<Device>, Vec<Record>)> {
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

    /// Something a uhid device's task passed on.
    pub fn hid_notice(&mut self, key: Key, notice: HidNotice) {
        let (session, slot) = key;
        let Some(replica) = self.pads.get(&key).and_then(|p| p.replica.as_ref()) else {
            // Unplugged since the task said it; nothing is waiting on it.
            return;
        };
        let (model, address, device, reporter) = (
            replica.model,
            replica.address,
            replica.device.clone(),
            replica.reporter.clone(),
        );
        match notice {
            HidNotice::Kernel(uhid::Event::Start) => {
                debug!(session, slot, "a driver took the device");
                self.schedule_discovery(key, 0);
            }
            HidNotice::Discover { attempt } => self.discover_nodes(key, attempt),
            HidNotice::Kernel(uhid::Event::Stop) => {
                debug!(session, slot, "the driver let go of the device");
            }
            HidNotice::Kernel(uhid::Event::Open | uhid::Event::Close) => {}
            HidNotice::Kernel(uhid::Event::Output { kind, data }) => {
                trace!(session, slot, kind, len = data.len(), "output report");
                self.rumble_from(key, &data);
            }
            HidNotice::Kernel(uhid::Event::GetReport { id, number, kind }) => {
                let answer = match kind {
                    uhid::REPORT_FEATURE => model.feature(number, address),
                    uhid::REPORT_INPUT => {
                        let current = reporter.lock().unwrap_or_else(|e| e.into_inner()).current();
                        (current.first() == Some(&number)).then_some(current)
                    }
                    _ => None,
                };
                // Some software asks for every report a descriptor declares,
                // and the real device answers only some: an unknown one is
                // expected, not a fault.
                debug!(
                    session,
                    slot,
                    number = format!("{number:#04x}"),
                    kind,
                    answered = answer.is_some(),
                    "a report was asked for"
                );
                let result = match answer {
                    Some(data) => device.get_report_reply(id, 0, &data),
                    None => device.get_report_reply(id, libc::EIO as u16, &[]),
                };
                if let Err(e) = result {
                    debug!(session, slot, id, "could not answer a request: {e}");
                }
            }
            HidNotice::Kernel(uhid::Event::SetReport {
                id,
                number,
                kind,
                data,
            }) => {
                trace!(session, slot, id, number, kind, "set report");
                if let Err(e) = device.set_report_reply(id, 0) {
                    debug!(session, slot, id, "could not answer a request: {e}");
                }
                if kind == uhid::REPORT_OUTPUT {
                    self.rumble_from(key, &data);
                }
            }
        }
    }

    /// Pass on the rumble a report written to a replica asks for.
    fn rumble_from(&mut self, key: Key, report: &[u8]) {
        let Some(replica) = self.pads.get_mut(&key).and_then(|p| p.replica.as_mut()) else {
            return;
        };
        let Some(rumble) = replica.model.rumble(report) else {
            return;
        };
        if rumble == replica.rumble {
            return;
        }
        replica.rumble = rumble;
        let (strong, weak) = rumble;
        let _ = self.feedback.send((
            key.0,
            PadFeedback::Rumble {
                slot: key.1,
                strong,
                weak,
                duration_ms: 0,
            },
        ));
    }

    fn discover_nodes(&mut self, key: Key, attempt: u32) {
        let (session, slot) = key;
        let Some(pad) = self.pads.get(&key) else {
            return;
        };
        let Some(Replica {
            syspath: None,
            vendor,
            product,
            ..
        }) = pad.replica
        else {
            return;
        };
        let name = pad.identity.name.clone();
        let claimed: HashSet<PathBuf> = self
            .pads
            .values()
            .filter_map(|p| p.replica.as_ref()?.syspath.clone())
            .collect();
        match discover(code::BUS_USB, vendor, product, &claimed) {
            Some((found, nodes)) => self.nodes_found(key, found, nodes),
            None if attempt + 1 < DISCOVER_ATTEMPTS => self.schedule_discovery(key, attempt + 1),
            None => {
                warn!(
                    session,
                    slot,
                    "the kernel made no nodes for \"{name}\", so only its gamepad can be read"
                );
                self.plug_copy(key);
            }
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
        if let Some(replica) = self.pads.get_mut(&key).and_then(|p| p.replica.as_mut()) {
            replica.records = records;
            replica.syspath = Some(found);
        }
        self.plug_copy(key);
    }

    /// The gamepad beside a replica, under a neutral identity (see the module
    /// docs).
    fn plug_copy(&mut self, key: Key) {
        let Some(pad) = self.pads.get(&key) else {
            return;
        };
        if pad.gamepad.is_some() {
            return;
        }
        let gamepad = self.plug(key, layout::generic(&pad.identity));
        if let Some(pad) = self.pads.get_mut(&key) {
            pad.gamepad = gamepad;
        }
    }

    fn remove(&mut self, key: Key) {
        let Some(pad) = self.pads.remove(&key) else {
            return;
        };
        let mut records = Vec::new();
        // Destroyed explicitly, before anyone is told it is gone. Dropping the
        // handle would not do it: an aborted task holds another, and lets go
        // of it only when the runtime next gets round to dropping the task.
        if let Some(gamepad) = pad.gamepad {
            gamepad.task.abort();
            gamepad.device.destroy();
            records.extend(gamepad.records.into_iter().rev());
        }
        if let Some(replica) = pad.replica {
            for task in &replica.tasks {
                task.abort();
            }
            replica.device.destroy();
            records.extend(replica.records.into_iter().rev());
        }
        if let Some(udev) = &self.udev {
            for record in &records {
                if let Err(e) = udev.remove(record) {
                    debug!("could not announce {} gone: {e}", record.devpath);
                }
            }
        }
        info!(
            session = key.0,
            slot = key.1,
            "controller unplugged: {}",
            pad.identity.name
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

/// Find the kernel's directory for a uhid device with this identity, and what
/// was made under it -- `None` until the hidraw node exists, which is the node
/// that matters.
///
/// The kernel names the directory `BUS:VENDOR:PRODUCT.INSTANCE`, and several
/// devices can share everything but the instance, so one already claimed by
/// another controller is skipped. Two identical devices started at the same
/// moment could be found the other way round, which costs nothing: the same
/// nodes are opened up and announced either way.
pub(crate) fn discover(
    bus: u16,
    vendor: u16,
    product: u16,
    claimed: &HashSet<PathBuf>,
) -> Option<(PathBuf, Nodes)> {
    let prefix = format!("{bus:04X}:{vendor:04X}:{product:04X}.");
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

/// Keep a replica's reports coming at the rate the real device sends them,
/// whether or not anything changed.
fn spawn_clock(
    device: Arc<uhid::Device>,
    reporter: Arc<Mutex<Reporter>>,
    every: Duration,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(every);
        // A late tick is a report that never happened, not one owed.
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tick.tick().await;
            let report = reporter.lock().unwrap_or_else(|e| e.into_inner()).next();
            if device.input(&report).is_err() {
                // Only ever a device on its way out; its removal stops this.
                continue;
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
