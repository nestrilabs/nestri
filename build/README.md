# build/ — the guest rootfs

Builds a bootable Artix/OpenRC image for the box's virtio-blk root: Mesa
(virtio-gpu native context) plus the four open guest components —
[`nescope`](../apps/nescope), [`neshub`](../apps/neshub),
[`neswire`](../apps/neswire), [`nescapture`](../apps/nescapture) — laid out
the way [borealis](https://chromium.googlesource.com/chromiumos/overlays/board-overlays/+/main/project-borealis)
lays out its `build/`: one big multi-stage `Dockerfile`, `--target` picks the
flavor, `etc/` holds the files that get overlaid onto the image verbatim.

```
build/
├── Dockerfile         everything, in stages: mesa-build, nestri-build,
│                       os-base, runtime, runtime_prod, runtime_debug
├── etc/                overlaid onto the image's /etc as-is
├── scripts/
│   └── mkimage.sh      docker export → raw ext4, for nesbox's virtio-blk
├── Makefile
└── output/             `make image` writes here (gitignored)
```

```sh
make build          # docker build --target runtime_prod   → nestrilabs/nestri:base
make build-debug    # docker build --target runtime_debug  → nestrilabs/nestri:base-debug
make image          # + pack into output/rootfs.ext4
make image-debug    # + pack into output/rootfs-debug.ext4
```

## Design notes

Three things worth knowing about how this is put together:

1. **No privileged host chroot.** A bare `chroot` into a hand-extracted
   rootfs needs `/proc`, `/sys`, `/dev` bind-mounted in first — they don't
   exist inside a chroot target until something puts them there. `os-base`
   here is `FROM artixlinux/artixlinux:base-openrc` directly, with
   `pacman -S` as plain `RUN` steps — a Docker build step already runs
   inside a real container with its own `/proc`, `/sys`, `/dev`, so that
   whole bind-mount mechanism has nothing to do.

2. **No host-side ownership bug to guard against.** `COPY --from=` runs as
   root inside the build with no host user in the loop, so there's no
   invoking-user uid getting stamped onto `/`, `/usr/bin`, or anywhere else
   a build step touches — a failure mode some overlay approaches need an
   explicit sanity check for doesn't exist here to check for.

3. **One `cargo build --release --workspace`, not one stage per binary.**
   `nescope`, `neshub`, `neswire` and `nescapture` share one Cargo workspace
   and one `Cargo.lock` — a BuildKit cache mount on `target/` gives cargo's
   own incremental compiler per-crate isolation without needing a separate
   Docker stage (and a separate full rebuild of `nesprotocol`) per binary.

**What is deliberately not here: Proton, and Valve's `steamclient.so`.**
`nestri/CLAUDE.md` is explicit — *"Nothing closed may enter this repo. Not
source, not a dependency, not a directory that 'looked convenient'."* Both
are closed. `runtime_prod` from this Dockerfile — tagged
`nestrilabs/nestri:base` — is a complete, bootable, Steam-less guest image,
and also the shared foundation other builds start from: nesbox's jailer
image (see `nesbox/build/`) extracts Mesa and virglrenderer from it so the
guest and host sides of the virtio-gpu native-context protocol never drift
apart. Whatever layers Proton and the Steam client on top of it is a closed
build outside this repo, by design — not something this repo names, links
to, or depends on.

## The nesinit gap

Nothing in this image starts a payload. The old `nestri-guest-hub` did that
— per its own commit message, the open `neshub` *"loses `--proton`,
`--steamclient-so`, `--root` and the game uid/gid, and no longer ends by
handing the process to a controller... Deciding when the box is finished
belongs to `nesinit`."* `nesinit` — the guest init/session-supervisor that
would actually launch `nescope -- <payload>` and power the box down — is
referenced in commit messages and `nesbox/PROGRESS.md` but does not exist as
open code in either repo.

So `/etc/init.d/nescope` here starts nescope in **plain-compositor mode**
(no command after `--`): it comes up, provides the Wayland/X11 environment,
and waits for something to connect. That makes the image genuinely bootable
and testable — `neshub`, `neswire`, `nescope` all come up under OpenRC and
you get a real Wayland socket to point a client at — but running an actual
game is still nesinit's job, and nesinit isn't part of this build. Whoever
picks that up next should read `apps/neshub/README.md`'s "What it does not
do" section first.

## Network defaults

`/etc/init.d/guest-net` reads `nestri.ip=`/`nestri.gw=` off the kernel
command line, falling back to `172.30.0.2/24` via `172.30.0.1` if neither is
set — nesbox's own default tap addressing. Keep these in step if that
changes on the nesbox side.
