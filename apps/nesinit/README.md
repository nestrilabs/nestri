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

### It reports; it does not supervise

When the workload ends, the exit goes up the channel and the session is over.
`on_exit` says what that exit *means* — whether it ends the session — and
nothing here restarts anything. Starting something again is a decision for the
end that can see whether restarting is repair or a loop.

A signalled workload is reported as signalled, with no exit code. Reporting
`0` for a killed process would make a kill look like a clean run.

### What is not here yet

Mounting shares. The descriptor's `mounts` are refused rather than ignored — a
workload started without the shares it was promised fails later, somewhere
else, for a reason nobody can see from the guest.

### Testing

```
cargo test -p nesinit
```

No VM required, and that is the point of the two seams. Reaping is tested
against real forked children — `PR_SET_CHILD_SUBREAPER` makes a test process
inherit orphans the same way PID 1 does — and the channel is tested over an
in-memory pipe, because the transport contributes nothing to the protocol
beyond ordering and framing.
