# nesdoctor

**Is this machine any good — as a Nestri host, or as a client?**

```sh
# macOS and Linux
curl -fsSL https://doctor.nestri.io/install.sh | sh

# Windows
powershell -c "irm https://doctor.nestri.io/install.ps1 | iex"
```

Both download one binary, verify its checksum, run it, and delete it. They
install nothing, need no administrator rights, and touch no system directory.
**The scripts those URLs serve are the files in [`install/`](install/)** — the
worker fetches them from this repository, so you can read exactly what you are
about to run before you run it.

They pin a release tag rather than using `releases/latest`, because this
repository ships product releases too and `latest` is whichever went out most
recently. `NESDOCTOR_TAG` overrides it.

Or build it yourself:

```
cargo run --release -p nesdoctor
```

Checks every hard requirement for running a Nestri box, measures what your
connection actually does when it is busy, and asks at most five questions.

## Nothing is uploaded

There is no server. No telemetry endpoint exists, and there is no build of this
program that reports home — the network test talks to Cloudflare's public
speed-test sink and to `1.1.1.1`, neither of which is ours.

The output is a line on your terminal. If you want us to have it, you paste it
somewhere. If you do not, we never had it. That is a property of the design
rather than a promise about our intentions: there is nothing to switch on later.

The shareable line carries **no hostname, no IP, no username, no game titles and
no file paths** — a size band rather than a size, and an hour histogram rather
than timestamps. It is put on your clipboard at the end so pasting it is one
keystroke.

The long version lands in `nesdoctor.json`: every check with its reason, the
full latency series, and your installed titles with sizes and launch times if
you said yes to Steam. **That file is considerably more useful to us than the
line** — it is what lets us size a game library and see which requirement
actually stops people — so do have a read through it and send it along if
nothing in there bothers you. Plain JSON, entirely optional, and the one-line
version is already plenty.

Reading your Steam library needs an explicit yes, and the question is asked last,
after you have seen what this program does.

## The number worth running it for

Everybody knows their download speed. Almost nobody has seen **how much latency
their connection adds when it is busy**, and for anything interactive that is the
figure that decides it:

```
  upstream             39 Mbps
  latency, idle floor  55 ms
  latency, idle typ.  180 ms
  latency, loaded      95 ms
  added under load    +39 ms   grade C
```

Two idle figures because they answer different questions. **Floor** is the best
the path can do, and queueing is everything above it — so that is what the
bloat number is measured against. **Typical** is what a connection actually
gets, and where the two differ this much, the route itself is the problem.

A 500 Mbps uplink that queues for 300 ms under load cannot carry a game. A
25 Mbps one with `fq_codel` or CAKE can. If your grade is C or F it is almost
always a router setting rather than a line you need to upgrade.

## Options

| | |
|---|---|
| `--no-net` | Skip the network test (it uploads ~100 MB) |
| `--no-steam` | Never look at Steam, and do not ask |
| `--yes` | Take the defaults — for a second run, not a first |
| `--json <PATH>` | Where to write the full report |
| `--quiet` | Only the summary line, for scripting |
| `--no-open` | Do not offer to open a browser; just print the link |
| `--submit-url` | Where the submit link points (default `https://doctor.nestri.io`) |

## Verdicts

| | |
|---|---|
| `HOST-READY` | Passes everything, and close enough to the network to serve others |
| `HOST-READY-LOCAL` | Passes everything, but far enough out that it can only serve players nearby |
| `HOST-NET` | Good machine; the connection is in the way |
| `HOST-FIXABLE` | Nothing is a hardware limit — what is missing can be installed |
| `CLIENT` | Not a host. A complete answer, and what most machines are |
| `UNKNOWN` | A blocking check could not be run. An unknown is not a no |

## Your display, and why we ask

```
  presentation path   x11 · bspwm
  eDP-1               1920x1200 @ 60 Hz, 8-bit
  Vulkan decode       h264, h265
  VA-API decode       h264, h265, vp9
```

Read from your monitor's EDID and your session, not guessed. Resolution,
refresh, **colour depth**, which HDR transfer functions the panel accepts,
whether it takes BT.2020, whether it takes 4:2:0 chroma — plus what your
hardware can decode.

This decides real choices on our side: whether 10-bit is worth sending, whether
BT.2020 is worth encoding, which codec to reach for. Every one of those had
been decided against the single panel in one room.

Its other use is **attribution**. Told only that a stream "looks bad", the
cheapest explanation is always that we compressed it too hard — so without
knowing that a compositor is rescaling the picture, we would turn down our own
quality to pay for somebody else's window manager.

**Present mode, tearing and fractional scaling are not here.** They need a real
window and a swapchain, so they belong in the client, and are reported as
unknown rather than guessed.

## Sending it back

At the end it prints a link, lists in plain English what the link contains, and
opens it when you press Enter. That is the whole submission — no account, no
form, no email client.

One thing worth knowing if you are reading `install/install.sh`: it reopens
stdin on `/dev/tty` before handing over. Piped into a shell the documented way,
the script's stdin **is** the pipe and the pipe is at end of file, so without
that line `nesdoctor` correctly sees a non-terminal stdin and skips every
question — a run that completes, looks fine, and answers nothing. Running the
script from a file works perfectly, which is what makes it worth a comment.

The link is built from **readable query parameters** rather than an encoded
blob. A blob would be shorter and would let us send more; it would also mean you
cannot read what you are sending, which is the one thing this program has going
for it.

If you would rather not click a link we wrote, the short line is printed too and
put on your clipboard.

At the very end it offers to take an **email address** — optional, blank skips
it — so we can come to you when there is something to try. That is the only
identifying thing this program collects, it is asked last, and it appears in the
disclosure list like everything else so you see it before it is sent.

## What it deliberately does not tell you

- **A pass is not a promise.** Every check is a *necessary* condition. Nothing
  here runs under load, so a machine that passes can still fail on block I/O.
- **`vulkaninfo` reporting the encode extension is not proof the path works.**
  We have had a correct extension list over a broken path before.
- **The host's `virglrenderer` and Mesa are not checked at all**, on purpose.
  The box carries its own inside the image it runs in, so the host's copies are
  not on the path — and a row that could only ever say "present, patch state
  unknown" told prospective hosts their machine was wrong when it was not.

## Building

```
cargo build --release -p nesdoctor
```

Four dependencies, three of them `serde`/`clap`/`anyhow`. Everything that could
be done with `std` is: the VDF parser, the platform probes and the text wrapping
are all in-tree, because a binary handed to strangers has a dependency tree that
is part of its interface.

A static build, for a release someone downloads rather than compiles:

```
cargo build --release -p nesdoctor --target x86_64-unknown-linux-musl
```
