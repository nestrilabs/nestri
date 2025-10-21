pub mod proto;

pub struct CreateMessageOptions {
    pub sequence_id: Option<String>,
    pub latency: Option<proto::ProtoLatencyTracker>,
}

pub fn create_message(
    payload: proto::proto_message::Payload,
    payload_type: impl Into<String>,
    options: Option<CreateMessageOptions>,
) -> proto::ProtoMessage {
    let opts = options.unwrap_or(CreateMessageOptions {
        sequence_id: None,
        latency: None,
    });

    let latency = opts.latency.or_else(|| {
        opts.sequence_id.map(|seq_id| proto::ProtoLatencyTracker {
            sequence_id: seq_id,
            timestamps: vec![proto::ProtoTimestampEntry {
                stage: "created".to_string(),
                time: Some(prost_types::Timestamp::from(std::time::SystemTime::now())),
            }],
        })
    });

    proto::ProtoMessage {
        message_base: Some(proto::ProtoMessageBase {
            payload_type: payload_type.into(),
            latency,
        }),
        payload: Some(payload),
    }
}
