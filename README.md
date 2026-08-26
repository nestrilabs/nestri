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

## What is here

Two halves that meet over the network and share very little else.

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
| [`crates/nesprotocol`](crates/nesprotocol) | The wire types all three share, so no two ends can drift apart silently. |

The hypervisor these run under is [`nesbox`](https://github.com/nestrilabs/nesbox),
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

The Rust components expect a Linux host with a Wayland-capable GPU stack. They
are not much use on their own yet — they are pieces of a box, and the thing that
assembles a box is not open yet.

## Status

Working: the API, auth, the domain model, and the guest components listed above.

Not here yet: the box lifecycle, storage, the edge, and the client. Some of that
will open as it is written; some is deliberately closed. What decides which is
whether it handles your data — that half is open on principle — or decides our
capacity, which is the part we sell.

## Contributing

Early, and the ground moves. The most useful contribution right now is telling
us where the documentation failed you. Conventional commits; explain *why* in
the body.

## Licence

[Apache 2.0](LICENSE).
