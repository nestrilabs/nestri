# PyroWave transport

Status: approved design, 2026-10-01. Part 2 of 4; part 1 is
`2026-09-27-nespyro-codec-crate-design.md`.

## Why

The media path was built for hardware codecs over the internet: a frame is one
IPC message, the hub cuts it into byte slices, the client needs every slice,
keyframes ride reliable streams, and a controller ratchets the bitrate. None of
that fits PyroWave:

- A unix datagram tops out near 416 KB under the default `net.core.wmem_max`,
  and the hub reads into 2 MiB. A PyroWave frame is 400 KB at 200 Mbit/s and
  2 MB at 1 Gbit/s.
- Byte slicing throws away what PyroWave is built around: packets that each
  decode on their own, and a decoder that shows a frame missing some of them.
- Every PyroWave frame is intra. Flagged as a keyframe it would take the
  two-slot reliable path every frame; unflagged, `ResyncGate` withholds it.

## Decisions

- **Opt-in only.** `ClientCaps` advertises PyroWave, but `best()` and
  `CODEC_PREFERENCE` never return it. A session reaches it only by the client
  sending `MSG_ENCODE_SETTINGS` naming it.
- **No controller.** PyroWave runs at a static rate: what the request names, or
  the hub's `--pyrowave-kbps` default (300 000) when it names 0. The request is
  CBR, which already sets the controller to Manual (`note_manual_target`), so
  it stands down with no change to `control.rs`. The existing controller is
  slated for replacement and gets nothing new.
- **Critical packets sent twice**, first and again last, as datagrams. No
  reliable stream anywhere on the PyroWave path.
- **Shared logic in nesprotocol, pure.** Chunking, reassembly of IPC messages,
  datagram packing and the client-side collector are functions and state
  machines with an explicit clock. neshub wires them to sockets. nesprotocol
  keeps zero dependencies and does not depend on nespyro: packets are byte
  ranges to it.
- **The 4 MiB datagram buffer stays** for every codec. A hub-side skip guard
  keeps PyroWave's queue to about two frames instead.

## Scope

In part 2: nesprotocol, neshub, tests, a throughput bench. Not in part 2:

- nescapture (part 3) calls `chunk_frame`, reads the packet size from encode
  settings, and checks the format version it was built with.
- nesvideo (part 4) dispatches datagram kind 2 to `PyroCollector` and feeds a
  decoder. Moved from part 2: without a decoder the client never advertises
  PyroWave, so the glue would be unreachable. The collector itself is built and
  tested here, end to end through a real iroh connection.

## Wire

### Negotiation

- `CODEC_PYROWAVE = 4`. `ClientCaps` bit `4*2 + DEPTH_8` = decodes PyroWave SDR,
  `+ DEPTH_10` = decodes PyroWave HDR. Chroma is not a capability: anything
  running nespyro decodes 4:2:0 and 4:4:4.
- `PYROWAVE_FORMAT: u8 = 1`, meaning upstream `89f7e47`'s bitstream. The client
  appends it to `MSG_CLIENT_CAPS` as byte 3; `decode_client_caps` keeps reading
  the first two. `decode_pyrowave_format(payload) -> Option<u8>` reads it.
- Encode settings grow two appended fields, read only when present:
  `[codec][rc][value u32][depth][chroma][packet_size u16]`. `CHROMA_420 = 0`,
  `CHROMA_444 = 1`. The client sends packet size 0; the hub fills it in.
  `decode_encode_settings` keeps its signature; a new
  `decode_encode_settings_ext` returns a struct with the two options.

The hub refuses (logs, does not forward) a PyroWave request from a client
whose caps lacked PyroWave or carried a different `PYROWAVE_FORMAT`.

### IPC (nescapture → neshub), stream type `STREAM_PYROWAVE = 7`

The same 20-byte IPC header (codec `CODEC_PYROWAVE`, ts, width, height), and
its data is:

```text
[frame u32][msg index u16][msg count u16][critical u16][packet count u16]
then per packet: [len u16][bytes]
```

`frame` is a counter, `critical` the frame's total of leading critical packets
(the same in every message). Each message holds at most `IPC_PYROWAVE_MAX`
(64 KiB) of data and whole packets only, in frame order. A packet is at most
`max(packet_size, 2488)` bytes, the largest block, so `u16` lengths suffice.

### Datagram kind `DGRAM_PYROWAVE = 2`

```text
[1B kind][2B seq][2B index][2B total][4B ts_ms][1B flags][payload]
```

12 bytes. `seq` is the frame, `index`/`total` count datagrams in it. A payload
is one whole packet, or one piece of a packet too large for a datagram:

- `FLAG_DUPLICATE` (bit 0): a second copy of a critical datagram. Same index.
- `FLAG_PART` (bit 1): a piece of one packet. Pieces occupy consecutive
  indexes from one marked `FLAG_FIRST_PART` (bit 2) to one marked
  `FLAG_LAST_PART` (bit 3). Both ends are marked so a receiver missing a piece
  can tell an orphaned middle from the start of the next run. Only a block
  larger than the payload limit does this, at most two or three pieces.

`total` is capped at `PYRO_MAX_DATAGRAMS = 16384`, about 19 MB a frame.

## neshub

- **Packet size.** On forwarding a PyroWave request, the hub fills
  `packet_size` with the smallest `max_datagram_size() - 12` across streaming
  clients (1100 with none). The command forwarder in `main.rs` does it, since
  it already serialises every command to nescapture. If the path later shrinks
  below that, `pack_datagrams` sends the now-oversized packets in pieces like
  any oversized block; nothing is dropped.
- **Listener.** The video socket accepts `STREAM_PYROWAVE` beside
  `STREAM_VIDEO`. `FrameAssembler` collects a frame's messages; an incomplete
  frame is abandoned when the next frame starts or after 100 ms, and counted.
  The receive buffer stays 2 MiB, which is 32 messages' worth.
- **Broadcast.** The per-session video channel carries an enum: a hardware
  frame as `Bytes`, or a PyroWave frame as `Arc<PyroFrame>`. Both are
  refcounted, which also removes today's per-client copy of every frame.
- **Writer.** PyroWave frames skip `ResyncGate` and `KeyframeSender` and keep a
  `seq` of their own. `pack_datagrams` lays them out (critical, rest, critical
  again) into one `BytesMut`, split without copying.
- **Skip guard** (`pyrowave::should_skip`, shared with the bench). Before sending, with `backlog = DGRAM_BUFFER_BYTES -
  datagram_send_buffer_space()`: skip the whole frame if the backlog exceeds
  this frame's size, or if backlog plus frame exceeds the buffer. The skipped
  frame's `seq` is reused (the transport doc's rule). A frame larger than the
  buffer itself can never go out; that is warned once. Skips are counted and
  logged at debug.

## The collector (client side, in nesprotocol)

`PyroCollector::push(datagram, now) -> Vec<PyroFrame>`, plus `poll(now)`.
Frames in flight by `seq`, each a slot per index (duplicates dropped by index).
A frame is released when:

1. every index has arrived, or
2. a newer frame has started and `GRACE` (2 ms) has passed since, or
3. `IDLE` (20 ms) has passed since its *last* datagram.

Not a deadline from the first datagram: on a saturated path a frame takes a
frame interval to arrive, so such a deadline tears every frame once the path is
slower than it assumes. The end-to-end burst test found this.

Released frames carry `seq`, `ts_ms`, packets in index order (piece runs joined,
broken runs dropped) and received/total. A datagram for a `seq` at or behind
the newest released one is stale and dropped. No reorder window, no IDR: every
frame stands alone. Whether a frame is decodable is the decoder's call.

Counts per frame: whole, partial, and datagrams lost, duplicated, stale.

## Testing

- **nesprotocol units:** chunk/assemble round trips including over 4 MB;
  packing never splits a packet that fits; oversized packets come back whole
  from pieces and a broken run is dropped; critical datagrams repeat with the
  same index; every release trigger; stale and duplicate datagrams; the
  negatives (`best()` never picks PyroWave, a wrong format is refused).
- **neshub end to end (CPU):** synthetic packets in as IPC messages through the
  real listener and writer, over an iroh loopback connection, into a collector.
  Byte-exact, clean and with dropped datagrams; the skip guard engages under a
  blocked receiver.
- **End to end with real nespyro frames:** moved to part 3, where nescapture
  produces them. Every released frame must give a `Depacketizer` the same
  readiness as the encoder's own packets.
- **Throughput:** `examples/pyro_bench.rs` sends PyroWave-shaped frames at a
  given rate over iroh. Loopback measures CPU cost; serve/connect across the
  LAN measures the real thing. If iroh cannot carry the rates, that comes back
  as a design question before part 3.

## Order

nestri `feat/pyrowave`: nesprotocol, then neshub, then the bench. nescore is
untouched until part 4 pins the rev.
