package relay

import (
	"github.com/pion/webrtc/v4"
	"time"
)

// MessageBase is the base type for WS/DC messages.
type MessageBase struct {
	PayloadType string          `json:"payload_type"`
	Latency     *LatencyTracker `json:"latency,omitempty"`
}

// MessageLog represents a log message.
type MessageLog struct {
	MessageBase
	Level   string `json:"level"`
	Message string `json:"message"`
	Time    string `json:"time"`
}

// MessageMetrics represents a metrics/heartbeat message.
type MessageMetrics struct {
	MessageBase
	UsageCPU        float64 `json:"usage_cpu"`
	UsageMemory     float64 `json:"usage_memory"`
	Uptime          uint64  `json:"uptime"`
	PipelineLatency float64 `json:"pipeline_latency"`
}

// MessageICECandidate represents an ICE candidate message.
type MessageICECandidate struct {
	MessageBase
	Candidate webrtc.ICECandidateInit `json:"candidate"`
}

// MessageSDP represents an SDP message.
type MessageSDP struct {
	MessageBase
	SDP webrtc.SessionDescription `json:"sdp"`
}

// JoinerType is an enum for the type of incoming room joiner
type JoinerType int

const (
	JoinerNode JoinerType = iota
	JoinerClient
)

func (jt *JoinerType) String() string {
	switch *jt {
	case JoinerNode:
		return "node"
	case JoinerClient:
		return "client"
	default:
		return "unknown"
	}
}

// MessageJoin is used to tell us that either participant or ingest wants to join the room
type MessageJoin struct {
	MessageBase
	JoinerType JoinerType `json:"joiner_type"`
}

// AnswerType is an enum for the type of answer, signaling Room state for a joiner
type AnswerType int

const (
	AnswerOffline AnswerType = iota // For participant/client, when the room is offline without stream
	AnswerInUse                     // For ingest/node joiner, when the room is already in use by another ingest/node
	AnswerOK                        // For both, when the join request is handled successfully
)

// MessageAnswer is used to send the answer to a join request
type MessageAnswer struct {
	MessageBase
	AnswerType AnswerType `json:"answer_type"`
}

// MessageForwardSDP is used to relay SDP messages between relays
type MessageForwardSDP struct {
	MessageBase
	ParticipantID string                    `json:"participant_id"`
	SDP           webrtc.SessionDescription `json:"sdp"`
}

// MessageForwardICE is used to relay ICE candidates between relays
type MessageForwardICE struct {
	MessageBase
	ParticipantID string                  `json:"participant_id"`
	Candidate     webrtc.ICECandidateInit `json:"candidate"`
}

// MessageMeshHandshake is sent when a relay connects to another relay.
type MessageMeshHandshake struct {
	MessageBase
	RelayID string `json:"relay_id"`
}

// MessageMeshHandshakeResponse is sent back after a successful handshake.
type MessageMeshHandshakeResponse struct {
	MessageBase
	RelayID string `json:"relay_id"`
}

// MessageStreamRequest is sent to request a stream from another relay
type MessageStreamRequest struct {
	MessageBase
	RoomName string `json:"room_name"`
}

// MessageStreamForward is sent to forward stream data from one relay to another
type MessageStreamForward struct {
	MessageBase
	RoomName string `json:"room_name"`
	TrackID  string `json:"track_id"`
}

// MessageForwardIngest is used to forward ingest to another relay
type MessageForwardIngest struct {
	MessageBase
	RoomName string `json:"room_name"`
}

// MessageStateSync is used to synchronize the state of the room between relays
type MessageStateSync struct {
	MessageBase
	State map[string]RoomState `json:"state"`
}

// SendLogMessageWS sends a log message to the given WebSocket connection.
func (ws *SafeWebSocket) SendLogMessageWS(level, message string) error {
	msg := MessageLog{
		MessageBase: MessageBase{PayloadType: "log"},
		Level:       level,
		Message:     message,
		Time:        time.Now().Format(time.RFC3339),
	}
	return ws.SendJSON(msg)
}

// SendMetricsMessageWS sends a metrics message to the given WebSocket connection.
func (ws *SafeWebSocket) SendMetricsMessageWS(usageCPU, usageMemory float64, uptime uint64, pipelineLatency float64) error {
	msg := MessageMetrics{
		MessageBase:     MessageBase{PayloadType: "metrics"},
		UsageCPU:        usageCPU,
		UsageMemory:     usageMemory,
		Uptime:          uptime,
		PipelineLatency: pipelineLatency,
	}
	return ws.SendJSON(msg)
}

// SendICECandidateMessageWS sends an ICE candidate message to the given WebSocket connection.
func (ws *SafeWebSocket) SendICECandidateMessageWS(candidate webrtc.ICECandidateInit) error {
	msg := MessageICECandidate{
		MessageBase: MessageBase{PayloadType: "ice"},
		Candidate:   candidate,
	}
	return ws.SendJSON(msg)
}

// SendSDPMessageWS sends an SDP message to the given WebSocket connection.
func (ws *SafeWebSocket) SendSDPMessageWS(sdp webrtc.SessionDescription) error {
	msg := MessageSDP{
		MessageBase: MessageBase{PayloadType: "sdp"},
		SDP:         sdp,
	}
	return ws.SendJSON(msg)
}

// SendAnswerMessageWS sends an answer message to the given WebSocket connection.
func (ws *SafeWebSocket) SendAnswerMessageWS(answer AnswerType) error {
	msg := MessageAnswer{
		MessageBase: MessageBase{PayloadType: "answer"},
		AnswerType:  answer,
	}
	return ws.SendJSON(msg)
}

// SendForwardSDPMessageWS sends an SDP relay message to a peer relay
func (ws *SafeWebSocket) SendForwardSDPMessageWS(participantID string, sdp webrtc.SessionDescription) error {
	msg := MessageForwardSDP{
		MessageBase:   MessageBase{PayloadType: "forward_sdp"},
		ParticipantID: participantID,
		SDP:           sdp,
	}
	return ws.SendJSON(msg)
}

// SendForwardICEMessageWS sends an ICE candidate relay message to a peer relay
func (ws *SafeWebSocket) SendForwardICEMessageWS(participantID string, candidate webrtc.ICECandidateInit) error {
	msg := MessageForwardICE{
		MessageBase:   MessageBase{PayloadType: "forward_ice"},
		ParticipantID: participantID,
		Candidate:     candidate,
	}
	return ws.SendJSON(msg)
}

// SendMeshHandshake sends a handshake message to another relay.
func (ws *SafeWebSocket) SendMeshHandshake(relayID string) error {
	msg := MessageMeshHandshake{
		MessageBase: MessageBase{PayloadType: "mesh_handshake"},
		RelayID:     relayID,
	}
	return ws.SendJSON(msg)
}

// SendMeshHandshakeResponse sends a handshake response to a relay.
func (ws *SafeWebSocket) SendMeshHandshakeResponse(relayID string) error {
	msg := MessageMeshHandshakeResponse{
		MessageBase: MessageBase{PayloadType: "mesh_handshake_response"},
		RelayID:     relayID,
	}
	return ws.SendJSON(msg)
}

// SendStreamRequest sends a stream request to another relay
func (ws *SafeWebSocket) SendStreamRequest(roomName string) error {
	msg := MessageStreamRequest{
		MessageBase: MessageBase{PayloadType: "stream_request"},
		RoomName:    roomName,
	}
	return ws.SendJSON(msg)
}

// SendStreamForward sends stream information to another relay
func (ws *SafeWebSocket) SendStreamForward(roomName, trackID string) error {
	msg := MessageStreamForward{
		MessageBase: MessageBase{PayloadType: "stream_forward"},
		RoomName:    roomName,
		TrackID:     trackID,
	}
	return ws.SendJSON(msg)
}

func (ws *SafeWebSocket) SendForwardIngestMessageWS(roomName string) error {
	msg := MessageForwardIngest{
		MessageBase: MessageBase{PayloadType: "forward_ingest"},
		RoomName:    roomName,
	}
	return ws.SendJSON(msg)
}

// SendStateSyncMessageWS sends a state sync message to the given WebSocket connection.
func (ws *SafeWebSocket) SendStateSyncMessageWS(state map[string]RoomState) error {
	msg := MessageStateSync{
		MessageBase: MessageBase{PayloadType: "state_sync"},
		State:       state,
	}
	return ws.SendJSON(msg)
}
