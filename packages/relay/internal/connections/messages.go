package connections

import (
	"encoding/json"
	"relay/internal/common"

	"github.com/pion/webrtc/v4"
)

// MessageBase is the base type for any JSON message
type MessageBase struct {
	Type    string                 `json:"payload_type"`
	Latency *common.LatencyTracker `json:"latency,omitempty"`
}

type MessageRaw struct {
	MessageBase
	Data json.RawMessage `json:"data"`
}

func NewMessageRaw(t string, data json.RawMessage) *MessageRaw {
	return &MessageRaw{
		MessageBase: MessageBase{
			Type: t,
		},
		Data: data,
	}
}

type MessageLog struct {
	MessageBase
	Level   string `json:"level"`
	Message string `json:"message"`
	Time    string `json:"time"`
}

func NewMessageLog(t string, level, message, time string) *MessageLog {
	return &MessageLog{
		MessageBase: MessageBase{
			Type: t,
		},
		Level:   level,
		Message: message,
		Time:    time,
	}
}

type MessageMetrics struct {
	MessageBase
	UsageCPU        float64 `json:"usage_cpu"`
	UsageMemory     float64 `json:"usage_memory"`
	Uptime          uint64  `json:"uptime"`
	PipelineLatency float64 `json:"pipeline_latency"`
}

func NewMessageMetrics(t string, usageCPU, usageMemory float64, uptime uint64, pipelineLatency float64) *MessageMetrics {
	return &MessageMetrics{
		MessageBase: MessageBase{
			Type: t,
		},
		UsageCPU:        usageCPU,
		UsageMemory:     usageMemory,
		Uptime:          uptime,
		PipelineLatency: pipelineLatency,
	}
}

type MessageICE struct {
	MessageBase
	Candidate webrtc.ICECandidateInit `json:"candidate"`
}

func NewMessageICE(t string, candidate webrtc.ICECandidateInit) *MessageICE {
	return &MessageICE{
		MessageBase: MessageBase{
			Type: t,
		},
		Candidate: candidate,
	}
}

type MessageSDP struct {
	MessageBase
	SDP webrtc.SessionDescription `json:"sdp"`
}

func NewMessageSDP(t string, sdp webrtc.SessionDescription) *MessageSDP {
	return &MessageSDP{
		MessageBase: MessageBase{
			Type: t,
		},
		SDP: sdp,
	}
}
