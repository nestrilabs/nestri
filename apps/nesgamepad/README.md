# nesgamepad

Turns the controllers plugged into a client into devices inside the box, where
a game finds them the way it finds real hardware.

[`neshub`](../neshub) forwards the client's messages about its controllers
unread, tagged with which client sent them. The client only describes a
controller -- vendor, product, name, and its whole state as a positional
snapshot on every change, which is all any platform's gamepad API can say -- and
nesgamepad decides what a game finds for it. Rumble a game asks for goes back
the same way. The wire format is in
[`nesprotocol::gamepad`](../../crates/nesprotocol/src/gamepad.rs).

A box with no controllers connected has no controller devices at all. That
matters: some games stop listening to the keyboard and mouse as soon as one
exists.

---

## What a controller becomes

**The device itself**, for a family nesgamepad can rebuild -- today the
DualShock 4. Some games read a controller as a HID device and parse its reports
by hand, to tell one family from another and show the right buttons, and
Proton hands them the raw device only when it has a hidraw node. So
nesgamepad makes one through `/dev/uhid`, from the real controller's report
descriptor, and writes the reports the real one would send for the state the
client reports, at the rate it sends them. What a game asks of the device --
calibration, firmware, its address -- is answered from values read off real
hardware, and rumble it writes goes back to the client. What the snapshot
cannot carry, motion and touch, reads as a controller at rest. See
[`replica.rs`](src/replica.rs).

Beside it goes **a gamepad under a neutral identity**, for games that read only
XInput. Proton gives XInput only to controllers it reads through SDL, and drops
one when a raw device with the same vendor and product exists, so the copy
carries neither -- which also keeps a game that recognises the family by those
numbers from mistaking the copy for the device. A game that can read a
controller both ways uses one at a time, so no press is answered twice.

**Anything else** becomes one uinput gamepad. A game rarely reads a controller
by its raw codes -- SDL, Wine and Steam look the identity up in a mapping
database written against the exact layout the Linux driver for that device
produces -- so the device is either built the way that driver builds it, from
the table in [`layout.rs`](src/layout.rs), or presented with the kernel's
generic gamepad layout under a neutral identity. Claiming a real device's
identity with a different layout scrambles its buttons, which is worse than
being unrecognised.

## Standing in for udev

A box has no udev, and games find controllers through libudev. nesgamepad
writes udev's database entries for its own devices and sends the hotplug
broadcast udev would have sent, for those devices and nothing else. The
details libudev checks, each of which fails silently, are written down in
[`udev.rs`](src/udev.rs).

It runs as root because libudev ignores a broadcast from anyone else, because it
opens each new device node to the workload, and because `/dev/uhid` is
root's alone.

## Running it

```bash
cargo run --release --bin nesgamepad
```

| Flag | Env | Default | Description |
| --- | --- | --- | --- |
| `--ipc` | `NESTRI_GAMEPAD_IPC` | `/tmp/nestri-gamepad.sock` | The hub's gamepad socket, which this dials |

`RUST_LOG` takes a standard tracing filter, e.g. `RUST_LOG=nesgamepad=debug`.
Every state change is logged at `trace`.

## Testing

```bash
cargo test -p nesgamepad
```

Three more build a real device through `/dev/uinput` and read it back the way
a game would, including a rumble upload, and four build one through
`/dev/uhid` -- one of them a rebuilt DualShock 4 -- and check reports in both
directions and a feature report a game asks for. They are ignored by default because they create a device on whatever
machine runs them, and the uhid ones need root:

```bash
cargo test -p nesgamepad kernel_tests -- --ignored
```

One more sends a real udev broadcast. It needs to be uid 0 in a network
namespace of its own, which `unshare -rn` gives without root, and is only
meaningful with a libudev monitor listening in that namespace to report
whether the broadcast was accepted.
