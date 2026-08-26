# neswire

A PipeWire sink that Opus-encodes guest audio and sends it to
[`neshub`](../neshub).

Audio in the guest has no speakers to reach, so neswire registers itself as an
output device and takes what anything plays into it. From the application's
side it is an ordinary sink.

---

## Running it

```bash
cargo run --release --bin neswire
```

Then select the **neswire** sink as the system output, or point an application
at it.

| Flag | Env | Default | Description |
| --- | --- | --- | --- |
| `--ipc-path` | `NESWIRE_IPC_PATH` | `/tmp/nestri-audio.sock` | Where to send Opus packets |
| `--channels` | `NESWIRE_CHANNELS` | `2` | `2` stereo, `6` for 5.1, `8` for 7.1 |
| `--packet-duration-ms` | `NESWIRE_PACKET_DURATION_MS` | `5` | Opus frame size in ms |
| `--bitrate-per-channel` | `NESWIRE_BITRATE_PER_CHANNEL` | `64` | kbps per channel |

`RUST_LOG` takes a standard tracing filter, e.g. `RUST_LOG=neswire=debug`.

Sample rate is fixed at 48 kHz, which is what Opus wants and what every
consumer device runs at anyway.

---

## Testing without a hub

neswire's only output is a Unix datagram socket that `neshub` binds, so running
it on a desktop means it has nothing to talk to — it retries `connect` forever
and there is no way to see what it would have sent. `hub-stub` binds that
socket and reports what arrives:

```bash
# terminal 1
cargo run --bin hub-stub

# terminal 2
cargo run --bin neswire
```

It **decodes** the Opus rather than counting bytes, and that distinction
matters more than it looks. Opus codes digital silence in about two bytes a
packet, so a sink that is receiving nothing but zeros still produces a steady
~3 kbps and looks correct on every meter downstream. Peak amplitude is what
tells a working sink from a silent one.

```bash
cargo run --bin hub-stub -- --channels 8    # match neswire's channel count
```

`hub-stub` mirrors `ipc_listener::run_audio_listener` in `neshub`: same bind,
same `0o666`, same stream-type and codec checks. Where the two disagree,
`neshub` is right and the stub should be corrected.

---

## Layout

```
src/
├── main.rs     CLI, wiring, the sink→encoder→IPC chain
├── sink.rs     the PipeWire sink itself
├── encoder.rs  Opus encode, including the multichannel mappings
└── bin/
    └── hub-stub.rs
```

---

## Licence

Apache 2.0. See [LICENSE](../../LICENSE).
