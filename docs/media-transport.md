# The media transport, as it actually behaves

Media rides one QUIC connection: video delta frames and audio as datagrams,
keyframes as short-lived unidirectional streams, cursor and stats and input as
streams of their own. Several things about that arrangement are not what they
look like, and we designed against the wrong model twice before reading the
source.

This file records what the transport *does*, with somewhere to check each
claim, and what follows from it. It is deliberately about behaviour rather than
about our code, because our code changes and this does not — except when the
dependency does, which is why the version is named.

Read against **iroh 1.1, which uses `noq` and `noq-proto` 1.3 — a quinn fork,
not quinn itself.** Paths below are inside `noq-proto` unless stated. Reading
upstream quinn instead is a mistake worth naming, because we made it: the
behaviour turned out to agree on every point here, but "turned out to" is
precisely the standard this file exists to replace. If the iroh or noq version
moves, re-read before trusting any of this.

## The rule

**A path is the unit of congestion, not a stream and not a connection.**
Everything else here follows from that one sentence, and almost every wrong
assumption we made came from forgetting some part of it.

## Congestion is per path, and shared by everything on that path

Each path carries its own congestion controller and its own pacer
(`connection/paths.rs`, `PathData::congestion` and `PathData::pacing_delay`),
and `poll_transmit` consults both for the path it is about to send on
(`connection/mod.rs`, in the transmit blocking checks). Within a path, every
stream and every datagram shares them, whatever the packet ends up carrying.

The "per path" part is not pedantry here: a connection commonly holds a relay
path and a direct path at once, they have different windows and different
round-trip times, and only the *selected* one describes where media is
currently going. Reading connection-level aggregates instead will average two
unrelated network conditions together.

So moving keyframes onto their own streams — which we did, and which was right
— changed the *delivery guarantee* and nothing else. A lost fragment no longer
destroys a keyframe, because QUIC retransmits stream data. But that keyframe
still competes for the same congestion window as everything else on the path,
and still queues in the same scheduler. Stream-versus-datagram is a reliability
distinction, not an isolation one.

The corollary is worth stating because it is tempting and wrong: **opening a
second connection does not create bandwidth.** At a 3 Mbps bottleneck a 150 KB
keyframe occupies about 400 ms of link time however it is carried. A second
connection turns strict queueing into competition between two flows over the
same bottleneck, which is sometimes what you want — but it is a change in
*fairness*, not in capacity, and it costs a second NAT traversal, a second
handshake and a second set of paths to manage.

## Datagrams are written before stream data

`populate_packet` fills each packet in a fixed order, and DATAGRAM frames come
before STREAM frames. Whatever datagrams are queued take their space first;
stream data gets the remainder.

Two consequences, and they point in opposite directions:

**Delta frames cannot be starved by keyframes.** A large keyframe simply
stretches out over many packets while deltas keep flowing beside it. This is
the behaviour we nearly built by hand before checking.

**Keyframes can be starved by delta frames.** On a saturated link a steady
stream of datagrams fills every packet, and the keyframe on its stream gets
leftovers. If the client is waiting on that keyframe to resynchronise, the
frames starving it are the very frames it cannot decode without it. That is a
feedback loop with no bottom, and it is what produced "26 keyframe fallbacks,
19 IDR requests" in the field: the recovery frame could not get out past the
frames that needed it to arrive first.

The fix is not to reorder the transport. It is to stop sending data that
depends on data the receiver does not have — see `dgram::ResyncGate`.

## The send path has no backpressure signal

`send_datagram` calls `datagrams().send(data, true)` (`noq/src/connection.rs`),
and that `true` is a `drop` flag: the queue makes room by **evicting the oldest
queued datagrams** via `make_space_for` and then returns `Ok`
(`connection/datagrams.rs`). It errors only for `TooLarge`, `UnsupportedByPeer`,
`Disabled`, and `ConnectionLost` — that is, for a datagram that was malformed
or a connection that is already gone, never for one the path could not carry.

(The same function with `drop: false` returns `Blocked` instead and is what
`send_datagram_wait` uses. That would give backpressure, at the cost of
prioritising old frames over current ones, which for live media is the wrong
trade.)

A sender overrunning the path is therefore told nothing at all. Any counter
fed by that return value cannot be non-zero however badly things are going,
which is exactly how a field report came to contain "encoder perfectly healthy,
zero frames dropped" beside a client receiving almost nothing. `send_datagram`
is still the right call for live media — waiting for buffer space prioritises
old frames over current ones — but its silence has to be designed around
rather than read as good news.

What *can* be read: `datagram_send_buffer_space()` for remaining room, and the
selected path's `stats()` for `cwnd`, `rtt` and `lost_packets`. Note "selected":
a connection commonly holds a relay path and a direct path at once, and only
the selected one describes where media is going.

## quinn already paces

`poll_transmit` blocks on a token-bucket pacer (`connection/pacing.rs`, reached
through `PathData::pacing_delay`) sized from that path's congestion window and
round-trip time, before every packet. Handing 150 fragments over in a tight
loop does *not* put 150 packets on the wire at once.

Application-level pacing on top of this is redundant, and worse than
redundant: it would spread transmission according to our guess at the available
rate, while the pacer underneath is using the measured window and RTT. If the
application is producing faster than the pacer drains, the answer is to produce
less — which is the bitrate controller's job — not to add a second pacer.

## What follows

These are the design rules we arrived at, and the reasoning is above rather
than in the code that implements them.

**Do not send what the receiver cannot use.** Frames that depend on a keyframe
the receiver is still waiting for are not merely wasted bandwidth; on this
transport they actively delay the keyframe.

**Do not leave a hole for something you chose not to send.** A receiver counts
a missing sequence number as loss, and that count feeds our own congestion
response. A sender that skips a frame *and* burns its sequence number makes the
controller lower the bitrate in response to the sender's own decision. Reusing
the number is safe precisely because nothing went out under it.

**Bound every suppression.** Withholding is correct only while the assumption
behind it holds. If the keyframe never comes, withholding forever converts a
recoverable freeze into a permanent black screen, so the suppression expires
and says that it did.

**Trust the receiver over the sender.** The sender's view of this path was
measured reporting 182 ms RTT with zero packet loss while the client received
almost nothing. Some of that gap is structural, per the section above. The far
end's report of what actually arrived is the only measurement that cannot be
quietly wrong in our favour.

## The method

Every item here was found by reading the dependency's source, and every one of
them contradicted something we believed. The first draft of this very file
cited the wrong crate — upstream quinn rather than the fork iroh actually
builds against — which is a good illustration of how little intuition is worth
here even when the conclusions survive. The same thing happened one layer
down, in Vulkan Video: rate control turned out to be session state rather than
per-frame state, `gopFrameCount` of zero means "implementation chooses" rather
than "infinite" (`UINT32_MAX` means infinite), and a hardcoded QP ceiling made
low bitrate targets silently unreachable. None of that was in any comment we
had written, and two of those we had confidently asserted the opposite of.

So: **when behaviour depends on a dependency's internals, read them, and write
down what you found with a path to check it against.** Not the documentation,
which is frequently about intent; not the interface, which is frequently about
what you may call rather than what will happen. A claim in this file that
nobody can verify in an afternoon is a claim that will be wrong within a year
and believed anyway.
