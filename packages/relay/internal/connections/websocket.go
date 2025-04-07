package connections

import (
	"encoding/json"
	"github.com/gorilla/websocket"
	"log/slog"
	"sync"
)

// OnMessageCallback is a callback for messages of given type
type OnMessageCallback func(data []byte)

// SafeWebSocket is a websocket with a mutex
type SafeWebSocket struct {
	*websocket.Conn
	sync.Mutex
	closed         bool
	closeCallback  func()                       // Callback to call on close
	closeChan      chan struct{}                // Channel to signal closure
	callbacks      map[string]OnMessageCallback // MessageBase type -> callback
	binaryCallback OnMessageCallback            // Binary message callback
	sharedSecret   []byte
}

// NewSafeWebSocket creates a new SafeWebSocket from *websocket.Conn
func NewSafeWebSocket(conn *websocket.Conn) *SafeWebSocket {
	ws := &SafeWebSocket{
		Conn:           conn,
		closed:         false,
		closeCallback:  nil,
		closeChan:      make(chan struct{}),
		callbacks:      make(map[string]OnMessageCallback),
		binaryCallback: nil,
		sharedSecret:   nil,
	}

	// Launch a goroutine to handle messages
	go func() {
		for {
			// Read message
			kind, data, err := ws.Conn.ReadMessage()
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure, websocket.CloseNoStatusReceived) {
				// If unexpected close error, break
				slog.Debug("WebSocket closed unexpectedly", "err", err)
				break
			} else if websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway, websocket.CloseAbnormalClosure, websocket.CloseNoStatusReceived) {
				break
			} else if err != nil {
				slog.Error("Failed reading WebSocket message", "err", err)
				break
			}

			switch kind {
			case websocket.TextMessage:
				// Decode message
				var msg MessageBase
				if err = json.Unmarshal(data, &msg); err != nil {
					slog.Error("Failed decoding WebSocket message", "err", err)
					continue
				}

				// Handle message type callback
				if callback, ok := ws.callbacks[msg.PayloadType]; ok {
					callback(data)
				} // TODO: Log unknown message payload type?
				break
			case websocket.BinaryMessage:
				// Handle binary message callback
				if ws.binaryCallback != nil {
					ws.binaryCallback(data)
				}
				break
			default:
				slog.Warn("Unknown WebSocket message type", "type", kind)
				break
			}
		}

		// Signal closure to callback first
		if ws.closeCallback != nil {
			ws.closeCallback()
		}
		close(ws.closeChan)
		ws.closed = true
	}()

	return ws
}

// SetSharedSecret sets the shared secret for the websocket
func (ws *SafeWebSocket) SetSharedSecret(secret []byte) {
	ws.sharedSecret = secret
}

// GetSharedSecret returns the shared secret for the websocket
func (ws *SafeWebSocket) GetSharedSecret() []byte {
	return ws.sharedSecret
}

// SendJSON writes JSON to a websocket with a mutex
func (ws *SafeWebSocket) SendJSON(v interface{}) error {
	ws.Lock()
	defer ws.Unlock()
	return ws.Conn.WriteJSON(v)
}

// SendBinary writes binary to a websocket with a mutex
func (ws *SafeWebSocket) SendBinary(data []byte) error {
	ws.Lock()
	defer ws.Unlock()
	return ws.Conn.WriteMessage(websocket.BinaryMessage, data)
}

// RegisterMessageCallback sets the callback for binary message of given type
func (ws *SafeWebSocket) RegisterMessageCallback(msgType string, callback OnMessageCallback) {
	if ws.callbacks == nil {
		ws.callbacks = make(map[string]OnMessageCallback)
	}
	ws.callbacks[msgType] = callback
}

// RegisterBinaryMessageCallback sets the callback for all binary messages
func (ws *SafeWebSocket) RegisterBinaryMessageCallback(callback OnMessageCallback) {
	ws.binaryCallback = callback
}

// UnregisterMessageCallback removes the callback for binary message of given type
func (ws *SafeWebSocket) UnregisterMessageCallback(msgType string) {
	if ws.callbacks != nil {
		delete(ws.callbacks, msgType)
	}
}

// UnregisterBinaryMessageCallback removes the callback for all binary messages
func (ws *SafeWebSocket) UnregisterBinaryMessageCallback() {
	ws.binaryCallback = nil
}

// RegisterOnClose sets the callback for websocket closing
func (ws *SafeWebSocket) RegisterOnClose(callback func()) {
	ws.closeCallback = func() {
		// Clear our callbacks
		ws.callbacks = nil
		ws.binaryCallback = nil
		// Call the callback
		callback()
	}
}

// Closed returns a channel that closes when the WebSocket connection is terminated
func (ws *SafeWebSocket) Closed() <-chan struct{} {
	return ws.closeChan
}

// IsClosed returns true if the WebSocket connection is closed
func (ws *SafeWebSocket) IsClosed() bool {
	return ws.closed
}
