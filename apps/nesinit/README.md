## nesinit

PID 1 inside a box.

A microVM has no init unless something is it. Three of the jobs are nobody
else's, and this is all of them:

- **Reaping.** A process whose parent dies is reparented to PID 1. Without a
  reaper, every orphan the workload leaves behind holds a pid and a slot in the
  process table until the guest is gone.
- **Ordered shutdown.** The workload stops first and alone, then everything
  else, then the disks are flushed and the machine is powered off. An init that
  returns leaves a guest running with nothing in it.
- **The guest end of the control channel.** One vsock connection out, carrying
  what to run in and what happened back.

It does not know what it is running. It is handed a command line, a set of
shares and what an exit means; there is no code path here that branches on
which workload it started, and there is not meant to be.

### The channel

The guest dials out on a fixed vsock port and speaks first:

```
guest → { "type": "ready", "protocol_version": 2 }
guest ← { "type": "boot", "exec": {...}, "mounts": [...], "geometry": {...}, "on_exit": {...} }
guest → { "type": "mounted" }
guest → { "type": "started" }
guest → { "type": "workload_exited", "exit_code": 0 }
```

Newline-delimited JSON. Dialling out rather than being connected to is worth
keeping for two reasons: the listener is up before the VM starts, so nothing
races a booting kernel and nothing has to retry, and the connection
establishing is itself the liveness signal — without it the far end needs a
timeout to tell a slow boot from a dead one.

The version goes out before anything is read, so a peer that cannot talk to
this build refuses it before handing over a descriptor rather than failing
later on a field that turned out to be missing.

The types are in [`nesprotocol::lifecycle`](../../crates/nesprotocol/src/lifecycle.rs),
behind the `lifecycle` feature, so both ends of the channel read one definition
and neither can drift from it silently.

`mounted` / `mount_failed` stay separate from `started` / `start_failed`
because the two want different things looked at: a share that did not appear
and a command that did not run are not the same incident. A failure carries the
reason in the words the operating system used, and the path it happened on — a
permission error on a named directory can be acted on, where "the share did not
mount" cannot.

### Two layers, one channel

The channel carries a lifecycle layer, above, and a payload layer that nesinit
relays and never reads:

```
{ "type": "payload", "channel": "<name>", "body": "<opaque string>" }
```

Both directions. Inside the guest an envelope crosses a unix socket at
`/nestri/payload.sock`, which the guest listens on and the workload dials into.
That socket is a mechanism and expected to change; the envelope is the boundary
and is not.

`body` is a string rather than nested JSON, deliberately. A document nesinit
can index into is a document nesinit can grow to depend on, and then the layer
is no longer opaque and the boundary it exists to draw is gone.

**An envelope is never logged.** Not the body, not truncated, not at debug
level. The channel name and the byte count are the whole of what may be said
about one — what crosses here includes credentials meant for the workload and
nothing else. `Payload`'s `Debug` is written by hand for the same reason: a
derived one puts the body one careless `{:?}` away from a log line.

### The shares

Each `mounts` entry is a tag, a path to put it at, and whether it is read-only.
The tag names an export and is never a path on the other side of the channel,
so the guest learns nothing about the filesystem it is handed a piece of.
Choosing *where* a share lands is the descriptor's job, not the guest's:
deciding that means knowing what the workload expects to find there, which is
exactly the knowledge a workload-independent init does not have.

Every share is mounted `nosuid` and `nodev`, whether or not it is writable. A
share is data handed to the guest, and no descriptor has a way to ask for a
setuid binary or a device node in one.

`uid` and `gid` in `exec` are load-bearing rather than hygiene. Whoever writes
the descriptor also exported the writable share, so the two have to agree; when
they do not, the first write is refused and the failure surfaces here as a
permission error with a path, instead of as a workload that misbehaves much
later for no visible reason.

### It reports; it does not supervise

When the workload ends, the exit goes up the channel and the session is over.
`on_exit` says what that exit *means* — whether it ends the session — and
nothing here restarts anything. Starting something again is a decision for the
end that can see whether restarting is repair or a loop.

A signalled workload is reported as signalled, with no exit code. Reporting
`0` for a killed process would make a kill look like a clean run.

### What is not here yet

`geometry` is carried and parsed but nothing consumes it: nesinit does not
start the guest's own services yet. `ticket` exists as a message with no
producer wired to it.

### Testing

```
cargo test -p nesinit
```

No VM required, and that is the point of the seams. Reaping is tested against
real forked children — `PR_SET_CHILD_SUBREAPER` makes a test process inherit
orphans the same way PID 1 does. The channel is tested over an in-memory pipe,
because the transport contributes nothing to the protocol beyond ordering and
framing. The relay is tested over a real unix socket. Mounting needs
privileges a test does not have, so what is asserted is the arguments and flags
the mount is given, which is where the read-only and `nosuid` decisions live.
