package relay

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"log/slog"
	"net/http"
	"strconv"
)

var httpMux *http.ServeMux

func InitHTTPEndpoint(_ context.Context, ctxCancel context.CancelFunc) error {
	// Create HTTP mux which serves our WS endpoint
	httpMux = http.NewServeMux()

	// Endpoints themselves
	httpMux.Handle("/", http.NotFoundHandler())
	// If control endpoint secret is set, enable the control endpoint
	if len(GetFlags().ControlSecret) > 0 {
		httpMux.HandleFunc("/api/control", corsAnyHandler(controlHandler))
	}
	// WS endpoint
	httpMux.HandleFunc("/api/ws/{roomName}", corsAnyHandler(wsHandler))
	// Mesh endpoint
	httpMux.HandleFunc("/api/mesh", corsAnyHandler(meshHandler))

	// Get our serving port
	port := GetFlags().EndpointPort
	tlsCert := GetFlags().TLSCert
	tlsKey := GetFlags().TLSKey

	// Log and start the endpoint server
	if len(tlsCert) <= 0 && len(tlsKey) <= 0 {
		slog.Info("Starting HTTP endpoint server", "port", port)
		go func() {
			if err := http.ListenAndServe(":"+strconv.Itoa(port), httpMux); err != nil {
				slog.Error("Failed to start HTTP server", "err", err)
				ctxCancel()
			}
		}()
	} else if len(tlsCert) > 0 && len(tlsKey) > 0 {
		slog.Info("Starting HTTPS endpoint server", "port", port)
		go func() {
			if err := http.ListenAndServeTLS(":"+strconv.Itoa(port), tlsCert, tlsKey, httpMux); err != nil {
				slog.Error("Failed to start HTTPS server", "err", err)
				ctxCancel()
			}
		}()
	} else {
		return errors.New("no TLS certificate or TLS key provided")
	}
	return nil
}

// logHTTPError logs (if verbose) and sends an error code to requester
func logHTTPError(w http.ResponseWriter, err string, code int) {
	if GetFlags().Verbose {
		slog.Error("HTTP error", "code", code, "message", err)
	}
	http.Error(w, err, code)
}

// corsAnyHandler allows any origin to access the endpoint
func corsAnyHandler(next func(w http.ResponseWriter, r *http.Request)) http.HandlerFunc {
	return func(res http.ResponseWriter, req *http.Request) {
		// Allow all origins
		res.Header().Set("Access-Control-Allow-Origin", "*")
		res.Header().Set("Access-Control-Allow-Methods", "*")
		res.Header().Set("Access-Control-Allow-Headers", "*")

		if req.Method != http.MethodOptions {
			next(res, req)
		}
	}
}

// wsHandler is the handler for the /api/ws/{roomName} endpoint
func wsHandler(w http.ResponseWriter, r *http.Request) {
	// Get given room name now
	roomName := r.PathValue("roomName")
	if len(roomName) <= 0 {
		logHTTPError(w, "no room name given", http.StatusBadRequest)
		return
	}

	// Get or create room in any case
	room := GetOrCreateRoom(roomName)

	// Upgrade to WebSocket
	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			return true
		},
	}
	wsConn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		logHTTPError(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Create SafeWebSocket
	ws := NewSafeWebSocket(wsConn)
	// Assign message handler for join request
	ws.RegisterMessageCallback("join", func(data []byte) {
		var joinMsg MessageJoin
		if err = json.Unmarshal(data, &joinMsg); err != nil {
			slog.Error("Failed to unmarshal join message", "err", err)
			return
		}

		slog.Debug("Join message", "room", room.Name, "joinerType", joinMsg.JoinerType)

		// Handle join request, depending if it's from ingest/node or participant/client
		switch joinMsg.JoinerType {
		case JoinerNode:
			// If room already online, send InUse answer
			if room.Online {
				if err = ws.SendAnswerMessageWS(AnswerInUse); err != nil {
					slog.Error("Failed to send InUse answer to node", "room", room.Name, "err", err)
				}
				return
			}
			room.assignWebSocket(ws)
			go ingestHandler(room)
		case JoinerClient:
			// Create participant and add to room regardless of online status
			participant := NewParticipant(ws)
			room.addParticipant(participant)
			// If room not online, send Offline answer
			if !room.Online {
				if err = ws.SendAnswerMessageWS(AnswerOffline); err != nil {
					slog.Error("Failed to send offline answer to participant", "room", room.Name, "err", err)
				}
			}
			go participantHandler(participant, room)
		default:
			slog.Error("Unknown joiner type", "joinerType", joinMsg.JoinerType)
		}

		// Unregister ourselves, if something happens on the other side they should just reconnect?
		ws.UnregisterMessageCallback("join")
	})
}

// controlMessage is the JSON struct for the control messages
type controlMessage struct {
	Type  string `json:"type"`
	Value string `json:"value"`
}

// controlHandler is the handler for the /api/control endpoint, for controlling this relay
func controlHandler(w http.ResponseWriter, r *http.Request) {
	// Check for control secret in Authorization header
	authHeader := r.Header.Get("Authorization")
	if len(authHeader) <= 0 || authHeader != GetFlags().ControlSecret {
		logHTTPError(w, "missing or invalid Authorization header", http.StatusUnauthorized)
		return
	}

	// Handle CORS preflight request
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	// Decode the control message
	var msg controlMessage
	if err := json.NewDecoder(r.Body).Decode(&msg); err != nil {
		logHTTPError(w, "failed to decode control message", http.StatusBadRequest)
		return
	}

	relay := GetRelay()
	switch msg.Type {
	case "join_mesh":
		// Join the mesh network, get relay address from msg.Value
		if len(msg.Value) <= 0 {
			logHTTPError(w, "missing relay address", http.StatusBadRequest)
			return
		}

		if err := relay.MeshManager.ConnectToRelay(msg.Value); err != nil {
			logHTTPError(w, "failed to join mesh network", http.StatusInternalServerError)
			return
		}
	default:
		logHTTPError(w, "unknown control message type", http.StatusBadRequest)
	}
}

// meshHandler processes mesh-related requests
func meshHandler(w http.ResponseWriter, r *http.Request) {
	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		logHTTPError(w, "WebSocket upgrade failed", http.StatusInternalServerError)
		return
	}

	safeWS := NewSafeWebSocket(conn)
	relay := GetRelay()

	safeWS.RegisterMessageCallback("mesh_handshake", func(data []byte) {
		var msg MessageMeshHandshake
		if err := json.Unmarshal(data, &msg); err != nil {
			slog.Error("Failed to parse mesh handshake request", "err", err)
			return
		}
		peerRelayID, err := uuid.Parse(msg.RelayID)
		if err != nil {
			slog.Error("Invalid relay ID in handshake request", "err", err)
			return
		}
		slog.Info("Received mesh handshake from relay", "peerRelayID", peerRelayID)
		relay.MeshManager.mutex.Lock()
		relay.MeshManager.relayWebSockets[peerRelayID] = safeWS
		relay.MeshManager.mutex.Unlock()
		if err := safeWS.SendMeshHandshakeResponse(relay.ID.String()); err != nil {
			slog.Error("Failed to send handshake response", "err", err)
			return
		}
	})

	safeWS.RegisterMessageCallback("state_sync", func(data []byte) {
		var msg MessageStateSync
		if err := json.Unmarshal(data, &msg); err != nil {
			slog.Error("Failed to decode state sync message", "err", err)
			return
		}
		remoteState := NewMeshState()
		remoteState.Rooms = msg.State
		relay.MeshManager.state.Merge(remoteState)
	})

	safeWS.RegisterMessageCallback("forward_sdp", func(data []byte) {
		var msg MessageForwardSDP
		if err := json.Unmarshal(data, &msg); err != nil {
			slog.Error("Failed to decode forwarded SDP message", "err", err)
			return
		}
		relay.MeshManager.HandleForwardedSDP(safeWS, msg)
	})

	safeWS.RegisterMessageCallback("forward_ice", func(data []byte) {
		var msg MessageForwardICE
		if err := json.Unmarshal(data, &msg); err != nil {
			slog.Error("Failed to decode forwarded ICE candidate", "err", err)
			return
		}
		relay.MeshManager.HandleForwardedICE(safeWS, msg)
	})

	safeWS.RegisterMessageCallback("forward_ingest", func(data []byte) {
		var msg MessageForwardIngest
		if err := json.Unmarshal(data, &msg); err != nil {
			slog.Error("Failed to decode forwarded ingest message", "err", err)
			return
		}
		relay.MeshManager.HandleForwardedIngest(safeWS, msg)
	})

	safeWS.RegisterMessageCallback("stream_request", func(data []byte) {
		var msg MessageStreamRequest
		if err := json.Unmarshal(data, &msg); err != nil {
			slog.Error("Failed to decode stream request", "err", err)
			return
		}
		relay.MeshManager.HandleStreamRequest(safeWS, msg)
	})
}
