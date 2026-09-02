<h1>
<p >
  <img src="./wordmark.svg" alt="Nestri logo" width="300" />
</p>
</h1>

<p><strong>Run your games on a GPU you don't own — or one you do.</strong> Nestri puts an interactive workload in a hardware-accelerated virtual machine and streams it to you over QUIC, at a latency that lets you play rather than watch.</p>

> [!NOTE]
> **This repository is mid-rewrite, and the documentation is behind the code.**
> The guest-side components arrived recently and their docs are thin. Nothing
> here is stable yet: expect directories to move and interfaces to change.
> Proper documentation is on the way — issues and questions are welcome in the
> meantime, and are genuinely useful for deciding what to write first.

## Try it now — `nesdoctor`

One thing here is finished and runs on its own machine, today:

```sh
# Linux and macOS
curl -fsSL https://doctor.nestri.io/install.sh | sh

# Windows
powershell -c "irm https://doctor.nestri.io/install.ps1 | iex"
```

It tells you whether your machine could **host** games for other people, and
measures the number that actually decides whether streaming a game feels
right — not your download speed, but **how much latency your connection adds
when it is busy**. A 500 Mbps uplink that queues for 300 ms under load cannot
carry a game; a 25 Mbps one with `fq_codel` can. Almost nobody has seen their
own figure.

```
  upstream             35 Mbps
  latency, idle floor  56 ms
  latency, loaded     185 ms
  added under load   +129 ms   grade F

  presentation path   x11 · bspwm
  eDP-1               1920x1200 @ 60 Hz, 8-bit
  Vulkan decode       h264, h265
```

It also reads your display out of its EDID — resolution, refresh, colour depth,
HDR transfer functions, BT.2020, chroma — and what your hardware can decode.
Those decide what is worth sending over the wire, and we would otherwise be
guessing from one panel in one room.

**It does not stream a game.** It is the piece that has to exist before
anything else can, and most machines will come back `CLIENT` — which is a real
answer, not a failure.

Downloads one binary, verifies its checksum, runs it, deletes it. Installs
nothing, needs no administrator rights, touches no system directory. Nothing is
uploaded: it prints a link, lists exactly what the link contains, and opens it
only if you press Enter. The scripts those URLs serve are
[`apps/nesdoctor/install/`](apps/nesdoctor/install) in this repository, so you
can read them before you run them.

Source and the full story: [`apps/nesdoctor`](apps/nesdoctor).

## What is here

Two halves that meet over the network and share very little else, plus one
thing that runs on your own machine.

### The control plane — TypeScript, on Cloudflare Workers

| | |
|---|---|
| [`apps/api`](apps/api) | The public REST API. Identity, teams, machines, games, pairing. |
| [`apps/auth`](apps/auth) | A self-hosted OpenAuth issuer — Steam and SSH-key login. |
| [`packages/core`](packages/core) | The domain: every table, every operation, no HTTP. |
| [`packages/auth`](packages/auth) | Shared auth types and subjects. |

Postgres for state, [Alchemy](https://alchemy.run) for infrastructure. See
[`docs/alchemy.md`](docs/alchemy.md).

### The guest — Rust, inside the box

These run *inside* a virtual machine, beside the game. None of them talk to the
control plane.

| | |
|---|---|
| [`apps/nescope`](apps/nescope) | A headless Wayland compositor for one fullscreen client. A lighter answer to the same problem gamescope solves. |
| [`apps/nescapture`](apps/nescapture) | A Vulkan implicit layer. It captures frames from inside the workload's own process and encodes them on the GPU that drew them — no copy out to the CPU and back. |
| [`apps/neswire`](apps/neswire) | Audio capture and transport. |
| [`apps/neshub`](apps/neshub) | One connection out of the box. Muxes video, audio, cursor and input into a single QUIC stream to the client. |
| [`crates/nesprotocol`](crates/nesprotocol) | The wire types they all share, so no two ends can drift apart silently. |

### On your own machine — Rust

| | |
|---|---|
| [`apps/nesdoctor`](apps/nesdoctor) | Whether a machine can host a box, and what its connection and display can really do. The first executable form of our host requirements — until it existed, a host was qualified by a human reading a table. Four dependencies; everything that could be done with the standard library is. |

The hypervisor the guest components run under is [`nesbox`](https://github.com/nestrilabs/nesbox),
a separate repository: a micro-VM with a real GPU in it, using virtio-gpu native
context rather than passthrough, so one card can host several boxes at once.

## Why a virtual machine

A container shares the host kernel, which makes strong isolation hard and a GPU
harder. A micro-VM boots in about as long, isolates properly, and — with native
context — gets close to bare-metal graphics. That choice is what makes "many
sandboxes, one GPU" possible instead of one tenant per card.

## Getting started

```sh
bun install
bun dev                      # control plane, local Cloudflare runtime

cargo build --workspace      # guest components
cargo test --workspace
```

The *guest* components expect a Linux host with a Wayland-capable GPU stack, and
are not much use on their own yet — they are pieces of a box, and the thing that
assembles a box is not open yet.

`nesdoctor` is the exception and needs none of that:

```sh
cargo run --release -p nesdoctor
```

## Status

Working: `nesdoctor` — released, and the only part a stranger can operate
today. The API, auth, the domain model, and the guest components listed above.

Not here yet: the box lifecycle, storage, the edge, and the client. Some of that
will open as it is written; some is deliberately closed. What decides which is
whether it handles your data — that half is open on principle — or decides our
capacity, which is the part we sell.

## Contributing

Early, and the ground moves. The two most useful things you can do right now
cost a minute each: **run `nesdoctor` and send the result**, because we have
almost no idea what the machines on the other end of this look like; and tell
us where the documentation failed you. Conventional commits; explain *why* in
the body.

## Licence

[Apache 2.0](LICENSE).
