package connections

import (
	"github.com/pion/webrtc/v4"
	"relay/internal/common"
	"time"
)

// MessageBase is the base type for WS/DC messages.
type MessageBase struct {
	PayloadType string                 `json:"payload_type"`
	Latency     *common.LatencyTracker `json:"latency,omitempty"`
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
