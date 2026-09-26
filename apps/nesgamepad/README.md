# nesgamepad

Turns the controllers plugged into a client into input devices inside the box,
where a game finds them the way it finds real hardware.

The client describes each controller it has: what it is and, on every change,
its whole state. [`neshub`](../neshub) forwards those messages unread, tagged
with which client sent them, and nesgamepad makes one virtual device per
controller through `/dev/uinput`. Rumble a game plays on that device goes back
the same way. The wire format is in
[`nesprotocol::gamepad`](../../crates/nesprotocol/src/gamepad.rs).

A box with no controllers connected has no controller devices at all. That
matters: some games stop listening to the keyboard and mouse as soon as one
exists.

---

## What a game sees

A game rarely reads a controller by its raw codes. SDL, Wine and Steam look the
device's identity up in a mapping database, and those mappings were written
against the exact layout the **Linux driver** for that device produces. So a
controller is presented in one of two ways:

- **One a Linux driver would drive**: the same name, identity, buttons and
  axis ranges that driver registers. The client's platform does not matter; a
  DualShock 4 on a Windows client appears in the box exactly as it would
  plugged into a Linux machine.
- **Anything else**: the kernel's generic gamepad layout, under the name the
  client gave but a neutral identity. Claiming a real device's identity with a
  different layout scrambles its buttons in every mapping layer, which is
  worse than being unrecognised.

The drivers covered are in [`layout.rs`](src/layout.rs). Adding one means
reading a real device's layout from sysfs and writing it down; the tests show
how.

## Standing in for udev

A box has no udev, and games find controllers through libudev. nesgamepad
writes udev's database entries for its own devices and sends the hotplug
broadcast udev would have sent, for those devices and nothing else. The
details libudev checks, each of which fails silently, are written down in
[`udev.rs`](src/udev.rs).

It runs as root because libudev ignores a broadcast from anyone else, and
because it opens each new device node to the workload.

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
a game would, including a rumble upload. They are ignored by default because
they create a device on whatever machine runs them:

```bash
cargo test -p nesgamepad kernel_tests -- --ignored
```

One more sends a real udev broadcast. It needs to be uid 0 in a network
namespace of its own, which `unshare -rn` gives without root, and is only
meaningful with a libudev monitor listening in that namespace to report
whether the broadcast was accepted.
