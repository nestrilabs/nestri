package relay

import (
	"github.com/gorilla/websocket"
	"log"
	"sync"
)

// SafeWebSocket is a websocket with a mutex
type SafeWebSocket struct {
	*websocket.Conn
	sync.Mutex
	closeCallback   func()                       // OnClose callback
	binaryCallbacks map[string]OnMessageCallback // MessageBase type -> callback
}

// NewSafeWebSocket creates a new SafeWebSocket from *websocket.Conn
func NewSafeWebSocket(conn *websocket.Conn) *SafeWebSocket {
	ws := &SafeWebSocket{
		Conn:            conn,
		closeCallback:   nil,
		binaryCallbacks: make(map[string]OnMessageCallback),
	}

	// Launch a goroutine to handle binary messages
	go func() {
		for {
			// Read binary message
			kind, data, err := ws.Conn.ReadMessage()
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure, websocket.CloseNoStatusReceived) {
				// If unexpected close error, break
				if GetFlags().Verbose {
					log.Printf("Unexpected WebSocket close error, reason: %s\n", err)
				}
				break
			} else if websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway, websocket.CloseAbnormalClosure, websocket.CloseNoStatusReceived) {
				break
			} else if err != nil {
				log.Printf("Failed to read WebSocket message, reason: %s\n", err)
				break
			}

			switch kind {
			case websocket.TextMessage:
				// Ignore, we use binary messages
				continue
			case websocket.BinaryMessage:
				// Decode message
				var msg MessageBase
				if err = DecodeMessage(data, &msg); err != nil {
					log.Printf("Failed to decode binary WebSocket message, reason: %s\n", err)
					continue
				}

				// Handle message type callback
				if callback, ok := ws.binaryCallbacks[msg.PayloadType]; ok {
					callback(data)
				} // TODO: Log unknown message type?
			default:
				log.Printf("Unknown WebSocket message type: %d\n", kind)
			}
		}

		// Call close callback
		if ws.closeCallback != nil {
			ws.closeCallback()
		}
	}()

	return ws
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
	ws.Lock()
	defer ws.Unlock()
	if ws.binaryCallbacks == nil {
		ws.binaryCallbacks = make(map[string]OnMessageCallback)
	}
	ws.binaryCallbacks[msgType] = callback
}

// UnregisterMessageCallback removes the callback for binary message of given type
func (ws *SafeWebSocket) UnregisterMessageCallback(msgType string) {
	ws.Lock()
	defer ws.Unlock()
	if ws.binaryCallbacks != nil {
		delete(ws.binaryCallbacks, msgType)
	}
}

// RegisterOnClose sets the callback for websocket closing
func (ws *SafeWebSocket) RegisterOnClose(callback func()) {
	ws.closeCallback = func() {
		// Clear our callbacks
		ws.Lock()
		ws.binaryCallbacks = nil
		ws.Unlock()
		// Call the callback
		callback()
	}
}
