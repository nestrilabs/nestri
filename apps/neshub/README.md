## neshub

One connection out of the box.

Everything inside the guest that produces or consumes a stream talks to neshub
over a Unix socket. neshub muxes it all into a single [iroh](https://www.iroh.computer)
QUIC endpoint and fans client input back the other way. A client dials that
endpoint with a *ticket* and gets video, audio, cursor and stats on it.

### The sockets

| socket | default | direction | carries |
| --- | --- | --- | --- |
| `--video-ipc` | `/tmp/nestri-video.sock` | nescapture → neshub | encoded video frames |
| `--audio-ipc` | `/tmp/nestri-audio.sock` | neswire → neshub | Opus packets |
| `--input-ipc` | `/tmp/nestri-input.sock` | neshub ↔ nescope | input out, cursor and stats back |
| `--stats-ipc` | `/tmp/nestri-stats.sock` | nescapture → neshub | encoder stats |
| `--screenshot-ipc` | `/tmp/nestri-screenshot.sock` | neshub → nescope | a picture of the screen, on request |
| `--ticket-ipc` | `/tmp/nestri-ticket.sock` | neshub → nesinit | the ticket, once |
| — | `/tmp/nescapture-cmd.sock` | neshub → nescapture | IDR requests, encode settings |

neshub is the listener on every one of them and the other side dials in. That
is deliberate: it removes the startup ordering problem entirely, since a
producer that is not running yet simply has not connected yet.

### The ticket

```
nestri:<base64 of {endpoint_addr, stream_name}>
```

Generated once per boot, when the endpoint binds. It is served on a socket
rather than printed because stdout here is a log file inside a virtual machine
and the person who needs it is outside one — `nesinit` reads it and carries it
to the host.

### What it does not do

neshub does not start the payload, know its name, or decide when the box is
finished — `nesinit` owns all three, and shuts the VM down around this process.
The same neshub binary serves a game, a desktop, or anything else that draws to
`nescope`, because it never learns which one it is looking at.

### Running it

```bash
cargo run --bin neshub                    # every socket at its default
cargo run --bin neshub -- --relay none    # direct connections only
RUST_LOG=neshub=debug cargo run --bin neshub
```
