package connections

import (
	"log/slog"
	gen "relay/internal/proto"

	"github.com/pion/webrtc/v4"
	"google.golang.org/protobuf/proto"
)

type OnMessageCallback func(data []byte)

// NestriDataChannel is a custom data channel with callbacks
type NestriDataChannel struct {
	*webrtc.DataChannel
	callbacks map[string]OnMessageCallback // MessageBase type -> callback
}

// NewNestriDataChannel creates a new NestriDataChannel from *webrtc.DataChannel
func NewNestriDataChannel(dc *webrtc.DataChannel) *NestriDataChannel {
	ndc := &NestriDataChannel{
		DataChannel: dc,
		callbacks:   make(map[string]OnMessageCallback),
	}

	// Handler for incoming messages
	ndc.OnMessage(func(msg webrtc.DataChannelMessage) {
		// If string type message, ignore
		if msg.IsString {
			return
		}

		// Decode message
		var base gen.ProtoMessageInput
		if err := proto.Unmarshal(msg.Data, &base); err != nil {
			slog.Error("failed to decode binary DataChannel message", "err", err)
			return
		}

		// Handle message type callback
		if callback, ok := ndc.callbacks["input"]; ok {
			go callback(msg.Data)
		} // We don't care about unhandled messages
	})

	return ndc
}

// SendBinary sends a binary message to the data channel
func (ndc *NestriDataChannel) SendBinary(data []byte) error {
	return ndc.Send(data)
}

// RegisterMessageCallback registers a callback for a given binary message type
func (ndc *NestriDataChannel) RegisterMessageCallback(msgType string, callback OnMessageCallback) {
	if ndc.callbacks == nil {
		ndc.callbacks = make(map[string]OnMessageCallback)
	}
	ndc.callbacks[msgType] = callback
}

// UnregisterMessageCallback removes the callback for a given binary message type
func (ndc *NestriDataChannel) UnregisterMessageCallback(msgType string) {
	if ndc.callbacks != nil {
		delete(ndc.callbacks, msgType)
	}
}

// RegisterOnOpen registers a callback for the data channel opening
func (ndc *NestriDataChannel) RegisterOnOpen(callback func()) {
	ndc.OnOpen(callback)
}

// RegisterOnClose registers a callback for the data channel closing
func (ndc *NestriDataChannel) RegisterOnClose(callback func()) {
	ndc.OnClose(callback)
}
