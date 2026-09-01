# nesdoctor

**Is this machine any good — as a Nestri host, or as a client?**

```
nesdoctor
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
than timestamps. The long version does include titles and paths, and it stays in
`nesdoctor.json` on your disk.

Reading your Steam library needs an explicit yes, and the question is asked last,
after you have seen what this program does.

## The number worth running it for

Everybody knows their download speed. Almost nobody has seen **how much latency
their connection adds when it is busy**, and for anything interactive that is the
figure that decides it:

```
  upstream            28 Mbps
  latency, idle      179 ms
  latency, loaded    198 ms
  added under load   +19 ms   grade B
```

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

## Verdicts

| | |
|---|---|
| `HOST-READY` | Passes everything, and close enough to the network to serve others |
| `HOST-READY-LOCAL` | Passes everything, but far enough out that it can only serve players nearby |
| `HOST-NET` | Good machine; the connection is in the way |
| `HOST-FIXABLE` | Nothing is a hardware limit — what is missing can be installed |
| `CLIENT` | Not a host. A complete answer, and what most machines are |
| `UNKNOWN` | A blocking check could not be run. An unknown is not a no |

## What it deliberately does not tell you

- **A pass is not a promise.** Every check is a *necessary* condition. Nothing
  here runs under load, so a machine that passes can still fail on block I/O.
- **`vulkaninfo` reporting the encode extension is not proof the path works.**
  We have had a correct extension list over a broken path before.
- **Whether `libvirglrenderer` carries the native-context patches cannot be
  determined from outside**, so that row reports presence only.

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
