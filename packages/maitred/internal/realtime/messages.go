package realtime

import (
	"encoding/json"
)

// BaseMessage is the generic top-level message structure
type BaseMessage struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

type CreatePayload struct{}

type StartPayload struct {
	ContainerID string `json:"container_id"`
}

type StopPayload struct {
	ContainerID string `json:"container_id"`
}

// ParseMessage parses a BaseMessage and returns the specific payload
func ParseMessage(data []byte) (BaseMessage, interface{}, error) {
	var base BaseMessage
	if err := json.Unmarshal(data, &base); err != nil {
		return base, nil, err
	}

	switch base.Type {
	case "create":
		var payload CreatePayload
		if err := json.Unmarshal(base.Payload, &payload); err != nil {
			return base, nil, err
		}
		return base, payload, nil
	case "start":
		var payload StartPayload
		if err := json.Unmarshal(base.Payload, &payload); err != nil {
			return base, nil, err
		}
		return base, payload, nil
	case "stop":
		var payload StopPayload
		if err := json.Unmarshal(base.Payload, &payload); err != nil {
			return base, nil, err
		}
		return base, payload, nil
	default:
		return base, base.Payload, nil
	}
}
