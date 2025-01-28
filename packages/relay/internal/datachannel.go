package relay

import (
	"github.com/pion/webrtc/v4"
	"log"
)

// NestriDataChannel is a custom data channel with callbacks
type NestriDataChannel struct {
	*webrtc.DataChannel
	binaryCallbacks map[string]OnMessageCallback // MessageBase type -> callback
}

// NewNestriDataChannel creates a new NestriDataChannel from *webrtc.DataChannel
func NewNestriDataChannel(dc *webrtc.DataChannel) *NestriDataChannel {
	ndc := &NestriDataChannel{
		DataChannel:     dc,
		binaryCallbacks: make(map[string]OnMessageCallback),
	}

	// Handler for incoming messages
	ndc.OnMessage(func(msg webrtc.DataChannelMessage) {
		// If string type message, ignore
		if msg.IsString {
			return
		}

		// Decode message
		var base MessageBase
		if err := DecodeMessage(msg.Data, &base); err != nil {
			log.Printf("Failed to decode binary DataChannel message, reason: %s\n", err)
			return
		}

		// Handle message type callback
		if callback, ok := ndc.binaryCallbacks[base.PayloadType]; ok {
			go callback(msg.Data)
		} // TODO: Log unknown message type?
	})

	return ndc
}

// SendBinary sends a binary message to the data channel
func (ndc *NestriDataChannel) SendBinary(data []byte) error {
	return ndc.Send(data)
}

// RegisterMessageCallback registers a callback for a given binary message type
func (ndc *NestriDataChannel) RegisterMessageCallback(msgType string, callback OnMessageCallback) {
	if ndc.binaryCallbacks == nil {
		ndc.binaryCallbacks = make(map[string]OnMessageCallback)
	}
	ndc.binaryCallbacks[msgType] = callback
}

// UnregisterMessageCallback removes the callback for a given binary message type
func (ndc *NestriDataChannel) UnregisterMessageCallback(msgType string) {
	if ndc.binaryCallbacks != nil {
		delete(ndc.binaryCallbacks, msgType)
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
