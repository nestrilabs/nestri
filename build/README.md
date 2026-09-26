# build/ — the guest rootfs

Builds a bootable Arch image for the box's virtio-blk root: Mesa (virtio-gpu
native context) plus the six open guest components —
[`nesinit`](../apps/nesinit), [`nescope`](../apps/nescope),
[`neshub`](../apps/neshub), [`neswire`](../apps/neswire),
[`nescapture`](../apps/nescapture), [`nesgamepad`](../apps/nesgamepad) — laid out
the way [borealis](https://chromium.googlesource.com/chromiumos/overlays/board-overlays/+/main/project-borealis)
lays out its `build/`: one big multi-stage `Containerfile`, `--target` picks the
flavor, `etc/` holds the files that get overlaid onto the image verbatim.

```
build/
├── Containerfile       everything, in stages: mesa-build, nestri-build,
│                       os-base, runtime, runtime_prod, runtime_debug
├── etc/                overlaid onto the image's /etc as-is
├── scripts/
│   └── mkimage.sh      docker export → raw ext4, for nesbox's virtio-blk
├── Makefile
└── output/             `make image` writes here (gitignored)
```

```sh
make build          # docker build --target runtime_prod   → ghcr.io/nestrilabs/nestri/base:latest
make build-debug    # docker build --target runtime_debug  → ghcr.io/nestrilabs/nestri/base:debug
make image          # + pack into output/rootfs.ext4
make image-debug    # + pack into output/rootfs-debug.ext4

make proton-image   # build Proton from source — hours
make proton-push    # build it and publish it
```

## Design notes

Three things worth knowing about how this is put together:

1. **No privileged host chroot.** A bare `chroot` into a hand-extracted
   rootfs needs `/proc`, `/sys`, `/dev` bind-mounted in first — they don't
   exist inside a chroot target until something puts them there. `os-base`
   here is `FROM archlinux:base` directly, with `pacman -S` as plain `RUN`
   steps — a Docker build step already runs inside a real container with its
   own `/proc`, `/sys`, `/dev`, so that whole bind-mount mechanism has nothing
   to do.

2. **No host-side ownership bug to guard against.** `COPY --from=` runs as
   root inside the build with no host user in the loop, so there's no
   invoking-user uid getting stamped onto `/`, `/usr/bin`, or anywhere else
   a build step touches — a failure mode some overlay approaches need an
   explicit sanity check for doesn't exist here to check for.

3. **One `cargo build --release --workspace`, not one stage per binary.**
   `nescope`, `neshub`, `neswire`, `nescapture` and `nesgamepad` share one Cargo workspace
   and one `Cargo.lock` — a BuildKit cache mount on `target/` gives cargo's
   own incremental compiler per-crate isolation without needing a separate
   Docker stage (and a separate full rebuild of `nesprotocol`) per binary.

**What is deliberately not here: Valve's `steamclient.so`.**
`nestri/CLAUDE.md` is explicit — *"Nothing closed may enter this repo. Not
source, not a dependency, not a directory that 'looked convenient'."* That one
is closed, so whatever layers it on top is a build outside this repo — not
something this repo names, links to, or depends on.

**Proton is here, and this paragraph used to say it was not.** The old wording
put Proton and `steamclient.so` together and called both closed, which is
wrong about Proton: it is compiled from source, which is not a thing you can
do with closed software. Keeping it out cost a box the only way it has to run
a Windows title, for a rule that did not apply to it.

What it is: **proton-ge built wow64-only**, pulled by tag as a
published image rather than rebuilt here, because it takes hours and moves
only when its own tag does. `PROTON_IMAGE` overrides the tag, and it has to be
declared before the first `FROM`: an `ARG` a `FROM` expands is global or it
is nothing, and getting that wrong fails with `no FROM statement found`, which
says nothing about the actual mistake. wow64 is the whole reason it is a build
of ours and not a released one. It runs 32-bit Windows code inside a 64-bit
unix process, so a box needs no lib32 glibc, no second Mesa for i686, and no
second capture layer for 32-bit titles to be captured. The released builds
carry a 32-bit unix side, which is exactly why they need `lib32-*`.

It costs about 1.4 GB of image, and it is the one thing in here that is
payload-shaped: a compatibility layer for Windows games in an image that is
otherwise indifferent to what it runs. The guest components stay indifferent
regardless — none of them branches on it, and the init does not know it
exists. What names it is the command a caller sends.

`runtime_prod` from this Containerfile — tagged
`ghcr.io/nestrilabs/nestri/base:latest` — is a complete, bootable guest image,
and also the shared foundation other builds start from: nesbox's jail image
(see `nesbox/build/`) extracts **Mesa** from it so the guest and host sides of
the virtio-gpu native-context protocol never drift apart. Only Mesa —
`virglrenderer` is the host half of that protocol and nesbox builds its own,
patched, from `nesbox/patches/`; nothing in this image carries it.

## The guest kernel

```sh
make kernel                          # clone if needed, configure, verify, build → output/vmlinux
make KERNEL_SRC=~/src/linux kernel   # build an existing tree instead
make kernel-clean                    # drop the tree and the image
```

CachyOS's fork (`KERNEL_REF` in the `Makefile`), taken for its scheduler
patches, not its config: theirs is a desktop build with thousands of modules,
and this guest has `CONFIG_MODULES` off and no `/lib/modules` at all.

- **`kernel/nestri.fragment` is the source of truth**, and says why each entry
  is there. It is merged onto the tree's `.config`, resolved with
  `olddefconfig`, and then **checked**: any entry that did not survive fails the
  build. `merge_config.sh` and `olddefconfig` both drop options quietly, and
  the worst of these fails as perfectly healthy, perfectly silent audio.
- **`kernel/base.config` is only a seed** for a tree with no `.config`, so a
  fresh clone does not start from `defconfig`'s enormous driver set. Change the
  fragment, not the seed and not a tree's `.config`.
- **`vmlinux`, not `bzImage`.** The guest is loaded as a raw ELF with no
  bootloader in the path. It is ~16 MB unstripped, which costs nothing at run
  time: only the loadable segments are mapped.
- **`-march=x86-64-v3`** goes in through `KCFLAGS`. It is safe in a kernel:
  the kernel's own `-mno-sse -mno-avx …` masks every vector extension off
  whatever the flag order, leaving v3's integer ISA.
- The tree is off the pinned ref (a bisect, a local patch)? The build warns
  and builds what is there rather than checking the ref out over your work.

### NVIDIA: the forwarding driver

```sh
make kernel                          # fetches virtio-nvgpu's dev branch and builds its driver in
make NVGPU_REF=<tag-or-commit> kernel
```

On an NVIDIA host the guest has no GPU of its own. It gets a virtio device
that carries the NVIDIA driver's ioctls to the host, and it runs NVIDIA's own
user-mode libraries against it. The guest half of that is a kernel driver from
[virtio-nvgpu](https://github.com/nestrilabs/virtio-nvgpu), which every build
fetches into `output/virtio-nvgpu` and builds into the kernel as
`CONFIG_VIRTIO_GPU_NV`. It has to be built in, because this kernel cannot load
modules. The driver's parameters therefore go on the command line as
`virtio_gpu_nv.<name>=`.

- **`NVGPU_REF` is a branch by default**, so a build takes the driver as it is
  that day. The commit that went in is written to `output/vmlinux.nvgpu-rev`,
  because a branch name does not tell you which driver a given `vmlinux`
  contains. If the fetch fails, the build uses the checkout it already has and
  warns that it is doing so.
- An AMD or Intel host is unaffected. The driver binds only to the forwarding
  device, and nothing offers that device to those guests.
- The NVIDIA libraries are **not** part of the image. They must be the same
  build as the host's kernel module, so the host shares its own copy with the
  guest at run time.

### Experimental: the Infinity scheduler

```sh
make KERNEL_INFINITY=1 kernel        # → output/vmlinux-infinity
```

Applies [infinity-sched](https://github.com/galpt/infinity-sched-new)'s
series (GPL-2), which reworks the fair, RT and DRM schedulers for latency
under load. It is pinned by commit (`INFINITY_REV`), and the series directory
comes from `KERNEL_REF`, since upstream publishes one per CachyOS release.

- **Its own tree and its own image.** It builds in `output/kernel-infinity`,
  so the stock kernel is never patched and switching between the two needs no
  revert.
- **All or nothing, zero fuzz.** The whole series is checked against the
  stacked result before any of it is applied. The applied commit is recorded in
  the tree; to move `INFINITY_REV`, start over with `make kernel-clean`.
- **Only the CPU half does anything here.** virtio-gpu does not use the DRM
  scheduler and `CONFIG_DRM_SCHED` is not built, so the GPU patch is compiled
  out. It is applied anyway because upstream says a partial series
  misbehaves.
- Upstream's `/sys/kernel/debug/infinity_*` counters need `CONFIG_DEBUG_FS`,
  which this kernel does not have.

## Two packages that look droppable and are not

`llvm-libs` is 164 MB, the largest single thing in the image after Proton, and
`lm_sensors` is only there because something links `libsensors`. Both look like
leftovers of a Mesa configuration that has since been trimmed, and both have
been checked rather than reasoned about: **`libgbm` links them**, and the
compositor needs GBM. Trimming the Mesa build does not reach them.

`lm_sensors` in particular was found the hard way. It used to arrive as a
dependency of the distribution's Mesa package, and dropping that package took
it away — leaving our own Mesa unable to resolve `libsensors.so.5`. Nothing in
a package list says that; the check below is what said it.

## Proton has its own cadence, and its own Containerfile

`make build` **pulls** Proton by tag; it does not build it. Building it takes
hours and it changes only when its tag moves, so it is one image published
once and copied into every guest image after that. `make proton-image` is
that build, and it lives here so the published tag stays reproducible from
this tree rather than from somebody's laptop.

```sh
make proton-image                    # the current tag
make PROTON_TAG=GE-Proton11-8 proton-image
make proton-clean                    # drop the source, build tree and ccache
```

**`PROTON_TAG` is the only thing to change.** The published version is derived
from it in the `Makefile` rather than written a second time, because the two
are the same number in two spellings — and an image whose name does not say
which Proton is inside it is worse than no image. The `Containerfile`'s own
`PROTON_IMAGE` default is a fallback for a bare container build; going through
`make` is what keeps them in step.

**The build runs on the host, not in a `podman build`.** proton-ge's build is
container-driven itself: `make` runs outside, and every step runs in the Steam
Runtime SDK image through the container engine, so the host needs only git,
make and podman. Wrapping that in a container build would mean nested
containers. So there are two steps:

1. `scripts/proton-build.sh` clones the tag with its submodules, applies
   proton-ge's patch set, and runs its build with one change: the arch list
   drops the 32-bit unix side, which is what makes it wow64-only. Everything
   happens under `output/proton/`, which is tens of gigabytes.
2. `Containerfile.proton` is `FROM scratch` with the built tree as its whole
   context, so the image is the tree and nothing else.

Things worth knowing before changing it:

- **A rerun of the same tag resumes.** The clone, the patching and the
  configure step each run once per tag, and proton-ge's own make picks up
  where it stopped. A new tag or `FORCE_REBUILD=1` starts the tree over;
  ccache and the cargo downloads survive both. `make clean` leaves all of it
  alone, and `make proton-clean` removes it.
- **The patch script does not fail on a patch that does not apply.** It
  carries on and exits 0, so `proton-build.sh` greps its output
  (`output/proton/patch.log`) and stops. Otherwise the result is an image
  that looks fine and is missing a fix.
- **`patches/proton-ge/` is ours, applied after proton-ge's own set.** It holds
  what wow64-only needs that proton-ge's makefile does not handle, and fixes
  for things a tag pinned that have since moved. Each patch says why it exists
  at its top, and each one fails the build outright once it stops applying,
  which on a tag bump is usually upstream having fixed it.
- **The patch script is not idempotent**, so a tree is patched exactly once.
  An interrupted run resets every submodule to the commits the tag pins before
  patching again.

## There is no init system in here, and that is the design

`nesinit` is PID 1. The image carries **no service manager, no init scripts,
no `udev` and no systemd** — `systemd-libs` stays, because `dbus-daemon` and
`wireplumber` link `libsystemd.so.0`, but nothing in the image can be PID 1
except `nesinit`, and the build fails if anything that could be turns up.

That is why this is plain Arch. The image used to be Artix, chosen for OpenRC,
and every cost of that choice — no `eudev`, no `agetty-openrc`, `udev` being
systemd's anyway, a runlevel edit not stopping a service another one still
needs — was paid for an init system that is no longer here.

**What replaced fourteen `rc-update` lines and nine init scripts:**

| was | now |
|---|---|
| `devfs`, `dmesg`, `udev`, `udev-trigger` | `devtmpfs` makes the nodes; init sets the two modes that matter. The compositor takes input through Wayland and opens nothing `udev` provides. Controllers are the one thing a game finds through `udev`, and `nesgamepad` announces the ones it creates itself |
| `guest-net`, `hostname`, `xdg-runtime`, `cgroups` | init, before it dials out |
| `dbus`, `dbus-session`, `pipewire`, `wireplumber`, `neshub`, `neswire`, `nesgamepad` | a table compiled into `nesinit` |
| `nescope` in the `default` runlevel | **not a service.** It wraps the workload and is started by a launch, with that launch's geometry, and dies with it |
| `agetty` on `hvc0` | nothing. See below |
| `/etc/fstab` | init's own mounts, and shares named in the boot descriptor |

**A box is launched into, not booted into something.** Init mounts what the
descriptor names, brings the table up, says it is ready, and then takes
commands — so an image on its own runs nothing at all, which is the point:
this image is payload-independent and there is no payload in it.

### Getting into a guest that will not boot

`init=/bin/bash` on the kernel command line. Nothing in the image offers a
login prompt — there is no getty in either flavour — and that is cheaper than
carrying one: `nesinit` is an ordinary program, so from that shell you can run
it by hand and watch it fail. `make build-debug` adds `vulkaninfo` and friends
and gives root a password for `su`; it does not add a console.

**A shell is not a booted box, and the difference bites immediately.** Nothing
the init does has happened: the root is read-only, `/run` and `/tmp` are still
directories on it rather than tmpfs, `/run/user/1000` is unwritable, and the
hostname is `(none)` rather than `nesbox` — which is the quickest way to tell
the two states apart. A compositor started in that shell fails on its own
socket, and the error names the runtime directory rather than the cause.

So run `nesinit` first. It mounts, prepares the directories, brings the
services up, then fails to reach a control channel that is not there and
exits — **leaving everything it prepared behind**, which is exactly what makes
the hand-run useful. Then start what you came to debug.

It is safe to run outside a box, and that took fixing: the shutdown path signals
every process it may signal and then powers the machine off, which is right for
PID 1 of a box and catastrophic anywhere else. Both steps are refused when it is
not PID 1, and it says so rather than doing it quietly.

If you would rather not run it at all, the two mounts it does that a compositor
needs are:

```sh
mount -t tmpfs -o mode=1777,size=64m tmpfs /tmp
mount -t tmpfs -o mode=755,size=32m  tmpfs /run
mkdir -p /run/user/1000 && chown 1000:1000 /run/user/1000 && chmod 0700 /run/user/1000
```

Making `/run/user/1000` writable in the *image* does not help, and is worth
saying because it is the obvious first thing to try: before the init runs, the
directory is on a read-only root, so its ownership is not what stops a write;
after the init runs, a fresh tmpfs is mounted over `/run` and the image's copy
of the directory is hidden underneath it.

The one thing this does not reach is a failure *before* the shell. If that
happens the evidence is on `console=hvc0` and nowhere else.

### Two build-time checks worth knowing about

Both exist because the failure they catch is invisible at runtime rather than
loud, which is the same reason the old build checked its `conf.d` files:

- **No hook may point at a program that is not in the image.** Removing
  systemd removes the script `dbus-reload.hook` calls, and a leftover hook
  produces `error: command failed to execute correctly` on every future pacman
  transaction — indistinguishable, in a log, from something that matters.
- **Nothing `nesinit` will look for may be missing.** Its service table is
  compiled in, so an absent `dbus-daemon` is not a build error by itself; it
  is a service that does not come up in a box somebody is waiting on.

## Network defaults

`nesinit` reads `nestri.ip=`/`nestri.gw=` off the kernel command line,
falling back to `172.30.0.2/24` via `172.30.0.1` if neither is set — the
host's own default tap addressing. Keep these in step if that changes on the
host side. A box started with no network device at all is a valid box and
boots without one.

The address is a per-boot parameter rather than an image setting because the
alternative makes every box built from this image the same host on the
network, and two of them collide the moment they run together. Same reasoning
for `/etc/machine-id`, which is a symlink into a tmpfs that init fills at
boot — the previous image baked one in, so every box built from it was the
same machine to anything that asked.

This is also the one thing in the image that keeps `iproute2` installed:
init runs `ip` rather than talking netlink, which is a hundred lines of
`unsafe` saved for an interface configured once.
