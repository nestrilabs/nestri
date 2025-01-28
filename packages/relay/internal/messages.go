package relay

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"github.com/pion/webrtc/v4"
	"time"
)

// OnMessageCallback is a callback for binary messages of given type
type OnMessageCallback func(data []byte)

// MessageBase is the base type for WS/DC messages.
type MessageBase struct {
	PayloadType    string         `json:"payload_type"`
	LatencyTracker LatencyTracker `json:"latency_tracker,omitempty"`
}

// MessageInput represents an input message.
type MessageInput struct {
	MessageBase
	Data string `json:"data"`
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

// EncodeMessage encodes a message to be sent with gzip compression
func EncodeMessage(msg interface{}) ([]byte, error) {
	// Marshal the message to JSON
	data, err := json.Marshal(msg)
	if err != nil {
		return nil, fmt.Errorf("failed to encode message: %w", err)
	}

	// Gzip compress the JSON
	var compressedData bytes.Buffer
	writer := gzip.NewWriter(&compressedData)
	_, err = writer.Write(data)
	if err != nil {
		return nil, fmt.Errorf("failed to compress message: %w", err)
	}
	if err := writer.Close(); err != nil {
		return nil, fmt.Errorf("failed to finalize compression: %w", err)
	}

	return compressedData.Bytes(), nil
}

// DecodeMessage decodes a message received with gzip decompression
func DecodeMessage(data []byte, target interface{}) error {
	// Gzip decompress the data
	reader, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("failed to initialize decompression: %w", err)
	}
	defer func(reader *gzip.Reader) {
		if err = reader.Close(); err != nil {
			fmt.Printf("failed to close reader: %v\n", err)
		}
	}(reader)

	// Decode the JSON
	err = json.NewDecoder(reader).Decode(target)
	if err != nil {
		return fmt.Errorf("failed to decode message: %w", err)
	}

	return nil
}

// SendLogMessageWS sends a log message to the given WebSocket connection.
func (ws *SafeWebSocket) SendLogMessageWS(level, message string) error {
	msg := MessageLog{
		MessageBase: MessageBase{PayloadType: "log"},
		Level:       level,
		Message:     message,
		Time:        time.Now().Format(time.RFC3339),
	}
	encoded, err := EncodeMessage(msg)
	if err != nil {
		return fmt.Errorf("failed to encode log message: %w", err)
	}

	return ws.SendBinary(encoded)
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
	encoded, err := EncodeMessage(msg)
	if err != nil {
		return fmt.Errorf("failed to encode metrics message: %w", err)
	}

	return ws.SendBinary(encoded)
}

// SendICECandidateMessageWS sends an ICE candidate message to the given WebSocket connection.
func (ws *SafeWebSocket) SendICECandidateMessageWS(candidate webrtc.ICECandidateInit) error {
	msg := MessageICECandidate{
		MessageBase: MessageBase{PayloadType: "ice"},
		Candidate:   candidate,
	}
	encoded, err := EncodeMessage(msg)
	if err != nil {
		return fmt.Errorf("failed to encode ICE candidate message: %w", err)
	}

	return ws.SendBinary(encoded)
}

// SendSDPMessageWS sends an SDP message to the given WebSocket connection.
func (ws *SafeWebSocket) SendSDPMessageWS(sdp webrtc.SessionDescription) error {
	msg := MessageSDP{
		MessageBase: MessageBase{PayloadType: "sdp"},
		SDP:         sdp,
	}
	encoded, err := EncodeMessage(msg)
	if err != nil {
		return fmt.Errorf("failed to encode SDP message: %w", err)
	}

	return ws.SendBinary(encoded)
}

// SendAnswerMessageWS sends an answer message to the given WebSocket connection.
func (ws *SafeWebSocket) SendAnswerMessageWS(answer AnswerType) error {
	msg := MessageAnswer{
		MessageBase: MessageBase{PayloadType: "answer"},
		AnswerType:  answer,
	}
	encoded, err := EncodeMessage(msg)
	if err != nil {
		return fmt.Errorf("failed to encode answer message: %w", err)
	}

	return ws.SendBinary(encoded)
}

// SendInputMessageDC sends an input message to the given DataChannel connection.
func (ndc *NestriDataChannel) SendInputMessageDC(data string) error {
	msg := MessageInput{
		MessageBase: MessageBase{PayloadType: "input"},
		Data:        data,
	}
	encoded, err := EncodeMessage(msg)
	if err != nil {
		return fmt.Errorf("failed to encode input message: %w", err)
	}

	return ndc.SendBinary(encoded)
}
