use anyhow::Result;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use iroh::EndpointAddr;
use serde::{Deserialize, Serialize};

/// A Nestri connection ticket.
///
/// Format: `nestri:<base64_serialized_ticket>`
///
/// Example: `nestri:eyJlbmRwb2ludF9hZGRyIjp7...`
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NestriTicket {
    pub endpoint_addr: EndpointAddr,
    pub stream_name: String,
}
impl NestriTicket {
    pub fn new(endpoint_addr: EndpointAddr, stream_name: String) -> Self {
        Self {
            endpoint_addr,
            stream_name,
        }
    }

    /// Encode the full ticket (including stream name) to a string.
    pub fn encode(&self) -> String {
        let ticket_bytes = serde_json::to_vec(self).unwrap_or_default();
        let ticket_b64 = URL_SAFE_NO_PAD.encode(&ticket_bytes);
        format!("nestri:{}", ticket_b64)
    }

    /// Decode a ticket string.
    pub fn decode(ticket: &str) -> Option<Self> {
        let rest = ticket.strip_prefix("nestri:")?;
        let ticket_bytes = URL_SAFE_NO_PAD.decode(rest.as_bytes()).ok()?;
        serde_json::from_slice(&ticket_bytes).ok()
    }
}
impl std::fmt::Display for NestriTicket {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.encode())
    }
}
impl std::str::FromStr for NestriTicket {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        NestriTicket::decode(s).ok_or_else(|| anyhow::anyhow!("invalid ticket format"))
    }
}

/// Generate a unique stream ID using UUID v7.
pub fn generate_stream_name() -> String {
    format!("stream-{}", uuid::Uuid::now_v7().as_simple())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The ticket crosses a process boundary as text, so a round trip that
    /// loses a field would be found by whoever cannot connect, not here.
    #[test]
    fn a_ticket_survives_the_round_trip() {
        let addr = EndpointAddr::from(iroh::SecretKey::generate().public());
        let ticket = NestriTicket::new(addr.clone(), "stream-abc".into());

        let decoded = NestriTicket::decode(&ticket.encode()).expect("a ticket we just encoded");

        assert_eq!(decoded.stream_name, "stream-abc");
        assert_eq!(decoded.endpoint_addr.id, addr.id);
    }

    #[test]
    fn anything_not_a_ticket_is_refused() {
        assert!(NestriTicket::decode("nestri:@@@not-base64@@@").is_none());
        assert!(NestriTicket::decode("stream-abc").is_none(), "no prefix");
    }

    /// Two boxes handing out the same stream name would collide in whatever is
    /// keyed by it.
    #[test]
    fn stream_names_differ() {
        assert_ne!(generate_stream_name(), generate_stream_name());
    }
}
