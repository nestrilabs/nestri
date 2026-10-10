//! Which codecs the encoder may pick, given everyone watching.
//!
//! There is one encoder and every client receives its output, so the codec it
//! picks has to be one that every client can decode. Each client states what it
//! decodes when it connects; forwarding each statement as it arrived let the
//! newest client decide, so a client that only decodes H.264 went black the
//! moment one that decodes AV1 joined. The hub is the only place that sees all
//! of them, so it keeps the statements and hands the encoder their
//! intersection instead -- and recomputes it when a client leaves, so the room
//! moves to a better codec once the client holding it back is gone.

use std::collections::HashMap;
use std::hash::Hash;

use nesprotocol::{CODEC_PYROWAVE, ClientCaps, ControlMode, DEPTH_8, DEPTH_10};
use tokio::sync::Mutex;
use tracing::{info, warn};

use crate::control::Controller;

/// Every client's stated capabilities, and the joint set last given to the
/// encoder.
pub struct Agreement<K> {
    stated: HashMap<K, ClientCaps>,
    sent: Option<ClientCaps>,
}

impl<K: Eq + Hash> Default for Agreement<K> {
    fn default() -> Self {
        Self {
            stated: HashMap::new(),
            sent: None,
        }
    }
}

impl<K: Eq + Hash> Agreement<K> {
    /// Record what `client` decodes, replacing anything it said before.
    pub fn state(&mut self, client: K, caps: ClientCaps) {
        self.stated.insert(client, caps);
    }

    /// Drop a client that has left.
    ///
    /// Once nobody is left, the next client to arrive is told about from
    /// scratch rather than compared with a room that no longer exists.
    pub fn forget(&mut self, client: &K) {
        self.stated.remove(client);
        if self.stated.is_empty() {
            self.sent = None;
        }
    }

    /// What every client that has spoken can decode. `None` when none has.
    ///
    /// A client that never states its capabilities is left out rather than
    /// read as decoding nothing, which is how the encoder already treats one
    /// on its own: it has no opinion, and an empty set would erase everyone
    /// else's.
    pub fn joint(&self) -> Option<ClientCaps> {
        self.stated
            .values()
            .copied()
            .reduce(|a, b| ClientCaps::from_bits(a.bits() & b.bits()))
    }

    /// The joint set, if the encoder has not been given it yet.
    pub fn pending(&self) -> Option<ClientCaps> {
        self.joint().filter(|joint| Some(*joint) != self.sent)
    }

    /// Note that the encoder now has `caps`.
    pub fn mark_sent(&mut self, caps: ClientCaps) {
        self.sent = Some(caps);
    }
}

/// A client's capabilities as this hub should count them.
///
/// A client that decodes some other PyroWave bitstream format cannot read this
/// hub's, so its PyroWave bits are dropped rather than letting it vouch for a
/// stream it would show as garbage.
pub fn effective_caps(caps: ClientCaps, pyrowave_format: Option<u8>) -> ClientCaps {
    if pyrowave_format == Some(nesprotocol::pyrowave::PYROWAVE_FORMAT) {
        return caps;
    }
    let pyro = ClientCaps::empty()
        .with(CODEC_PYROWAVE, DEPTH_8)
        .with(CODEC_PYROWAVE, DEPTH_10);
    ClientCaps::from_bits(caps.bits() & !pyro.bits())
}

/// The shared [`Agreement`] for this hub's clients, and the one way of acting
/// on it.
pub struct Negotiator {
    agreement: std::sync::Mutex<Agreement<iroh::EndpointId>>,
    /// When the encoder was last told the set again; see [`Self::reassert`].
    reasserted: std::sync::Mutex<Option<std::time::Instant>>,
}

impl Negotiator {
    pub fn new() -> Self {
        Self {
            agreement: std::sync::Mutex::new(Agreement::default()),
            reasserted: std::sync::Mutex::new(None),
        }
    }

    pub fn state(&self, client: iroh::EndpointId, caps: ClientCaps) {
        self.agreement.lock().unwrap().state(client, caps);
    }

    pub fn forget(&self, client: &iroh::EndpointId) {
        self.agreement.lock().unwrap().forget(client);
    }

    /// Give the encoder the joint set if it has changed since it was last
    /// given one.
    ///
    /// Called whenever the set can have changed -- a client stating its
    /// capabilities, a client leaving -- and when the controller goes back to
    /// automatic. Repeating a set the encoder already has costs nothing there:
    /// a change that asks for the current settings is skipped without a
    /// rebuild.
    ///
    /// In manual mode nothing is sent and nothing is marked as sent. A person
    /// choosing sets the codec and the depth together, and a client joining
    /// must not renegotiate either; the set waits until the mode is automatic
    /// again.
    pub async fn settle(
        &self,
        controller: &Mutex<Controller>,
        cmd_tx: &tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
    ) {
        let manual = controller.lock().await.mode() == ControlMode::Manual;
        let mut agreement = self.agreement.lock().unwrap();
        let Some(joint) = agreement.pending() else {
            return;
        };
        if manual {
            info!(
                "clients jointly decode {:#010b}, but the encoder is set by hand; leaving it alone",
                joint.bits()
            );
            return;
        }
        agreement.mark_sent(joint);
        if joint.is_empty() {
            // The encoder reads an empty set as no opinion and keeps going,
            // which is all that is left to do: whatever it sends, someone
            // cannot show it.
            warn!(
                "the {} connected clients share no codec; at least one of them will not be \
                 able to decode the stream",
                agreement.stated.len()
            );
            return;
        }
        info!(
            "{} client(s) jointly decode {:#010b}",
            agreement.stated.len(),
            joint.bits()
        );
        let mut cmd = vec![nesprotocol::MSG_CLIENT_CAPS];
        nesprotocol::encode_client_caps(&mut cmd, joint);
        let _ = cmd_tx.send(cmd);
    }

    /// A frame arrived in `codec`. When the clients agreed on a set that
    /// cannot decode it, the encoder never got the set: it was not listening
    /// yet when the set was sent, or it is a new one -- a launcher handing over
    /// to the game -- that started on its own default. Either way every client
    /// is dropping every frame, so the encoder is told again, at most once a
    /// second.
    pub async fn reassert(
        &self,
        codec: u8,
        controller: &Mutex<Controller>,
        cmd_tx: &tokio::sync::mpsc::UnboundedSender<Vec<u8>>,
    ) {
        let joint = {
            let agreement = self.agreement.lock().unwrap();
            match agreement.joint() {
                Some(joint) if !joint.is_empty() && !joint.supports_codec(codec) => joint,
                _ => return,
            }
        };
        {
            let mut last = self.reasserted.lock().unwrap();
            if last.is_some_and(|t| t.elapsed() < std::time::Duration::from_secs(1)) {
                return;
            }
            *last = Some(std::time::Instant::now());
        }
        if controller.lock().await.mode() == ControlMode::Manual {
            return;
        }
        warn!(
            codec,
            joint = format_args!("{:#010b}", joint.bits()),
            "the encoder sends a codec no client decodes; telling it again what they can"
        );
        self.agreement.lock().unwrap().mark_sent(joint);
        let mut cmd = vec![nesprotocol::MSG_CLIENT_CAPS];
        nesprotocol::encode_client_caps(&mut cmd, joint);
        let _ = cmd_tx.send(cmd);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nesprotocol::{CODEC_AV1, CODEC_H264, CODEC_H265};

    fn h264_only() -> ClientCaps {
        ClientCaps::empty().with(CODEC_H264, DEPTH_8)
    }

    fn everything() -> ClientCaps {
        ClientCaps::empty()
            .with(CODEC_H264, DEPTH_8)
            .with(CODEC_H265, DEPTH_8)
            .with(CODEC_H265, DEPTH_10)
            .with(CODEC_AV1, DEPTH_8)
            .with(CODEC_AV1, DEPTH_10)
    }

    #[test]
    fn a_capable_client_joining_does_not_outvote_a_limited_one() {
        let mut a = Agreement::default();
        a.state(1, h264_only());
        assert_eq!(a.pending(), Some(h264_only()));
        a.mark_sent(h264_only());

        a.state(2, everything());
        assert_eq!(a.joint(), Some(h264_only()));
        assert_eq!(a.pending(), None, "the room can still only take H.264");
    }

    #[test]
    fn the_limited_client_leaving_frees_the_rest_to_upgrade() {
        let mut a = Agreement::default();
        a.state(1, h264_only());
        a.state(2, everything());
        a.mark_sent(h264_only());

        a.forget(&1);
        assert_eq!(a.pending(), Some(everything()));
    }

    #[test]
    fn a_limited_client_joining_downgrades_the_room() {
        let mut a = Agreement::default();
        a.state(1, everything());
        a.mark_sent(everything());

        a.state(2, h264_only());
        assert_eq!(a.pending(), Some(h264_only()));
    }

    #[test]
    fn an_empty_room_starts_over() {
        let mut a = Agreement::default();
        a.state(1, everything());
        a.mark_sent(everything());
        a.forget(&1);
        assert_eq!(a.joint(), None);

        // The encoder may have moved since; the next client is said aloud
        // even though it matches what was last sent.
        a.state(2, everything());
        assert_eq!(a.pending(), Some(everything()));
    }

    #[test]
    fn a_client_that_never_spoke_has_no_vote() {
        let a: Agreement<u32> = Agreement::default();
        assert_eq!(a.joint(), None);
        assert_eq!(a.pending(), None);
    }

    #[test]
    fn restating_the_same_capabilities_changes_nothing() {
        let mut a = Agreement::default();
        a.state(1, everything());
        a.mark_sent(everything());
        a.state(1, everything());
        assert_eq!(a.pending(), None);
    }

    #[test]
    fn clients_sharing_nothing_give_an_empty_set() {
        let mut a = Agreement::default();
        a.state(1, h264_only());
        a.state(2, ClientCaps::empty().with(CODEC_AV1, DEPTH_8));
        assert_eq!(a.pending(), Some(ClientCaps::empty()));
    }

    #[test]
    fn a_foreign_pyrowave_format_does_not_count() {
        let caps = everything()
            .with(CODEC_PYROWAVE, DEPTH_8)
            .with(CODEC_PYROWAVE, DEPTH_10);
        let foreign = nesprotocol::pyrowave::PYROWAVE_FORMAT.wrapping_add(1);
        assert_eq!(effective_caps(caps, Some(foreign)), everything());
        assert_eq!(effective_caps(caps, None), everything());
        assert_eq!(
            effective_caps(caps, Some(nesprotocol::pyrowave::PYROWAVE_FORMAT)),
            caps
        );
    }

    /// The encoder came up on AV1 after a client that decodes only H.264 had
    /// already said so: the set is sent again, once, however many frames say
    /// it.
    #[tokio::test]
    async fn an_encoder_on_a_codec_nobody_decodes_is_told_again() {
        let negotiator = Negotiator::new();
        let controller = Mutex::new(Controller::new(crate::control::Limits::new(8000)));
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel();
        let client = iroh::SecretKey::from_bytes(&[7; 32]).public();
        negotiator.state(client, h264_only());
        negotiator.settle(&controller, &tx).await;
        assert!(rx.try_recv().is_ok(), "the first set is sent");

        // Frames in a codec the client decodes say nothing.
        negotiator.reassert(CODEC_H264, &controller, &tx).await;
        assert!(rx.try_recv().is_err());

        // AV1 frames: told again, and only once for a burst of them.
        for _ in 0..60 {
            negotiator.reassert(CODEC_AV1, &controller, &tx).await;
        }
        let cmd = rx.try_recv().expect("the set is sent again");
        assert_eq!(cmd[0], nesprotocol::MSG_CLIENT_CAPS);
        assert!(rx.try_recv().is_err(), "once a second, not once a frame");
    }
}
