package core

// ProtocolRegistry is a type holding all protocols to split away the bloat
type ProtocolRegistry struct {
	StreamProtocol *StreamProtocol
}

// NewProtocolRegistry initializes and returns a new protocol registry
func NewProtocolRegistry(relay *Relay) ProtocolRegistry {
	return ProtocolRegistry{
		StreamProtocol: NewStreamProtocol(relay),
	}
}
