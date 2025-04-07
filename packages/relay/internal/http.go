package internal

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/gorilla/websocket"
	"github.com/libp2p/go-reuseport"
	"log/slog"
	"net/http"
	"relay/internal/common"
	"relay/internal/connections"
	"strconv"
)

var httpMux *http.ServeMux

func InitHTTPEndpoint(_ context.Context, ctxCancel context.CancelFunc) error {
	// Create HTTP mux which serves our WS endpoint
	httpMux = http.NewServeMux()

	// Endpoints themselves
	httpMux.Handle("/", http.NotFoundHandler())
	// If control endpoint secret is set, enable the control endpoint
	if len(common.GetFlags().ControlSecret) > 0 {
		httpMux.HandleFunc("/api/control", corsAnyHandler(controlHandler))
	}
	// WS endpoint
	httpMux.HandleFunc("/api/ws/{roomName}", corsAnyHandler(wsHandler))

	// Get our serving port
	port := common.GetFlags().EndpointPort
	tlsCert := common.GetFlags().TLSCert
	tlsKey := common.GetFlags().TLSKey

	// Create re-usable listener port
	httpListener, err := reuseport.Listen("tcp", ":"+strconv.Itoa(port))
	if err != nil {
		return fmt.Errorf("failed to create TCP listener: %w", err)
	}

	// Log and start the endpoint server
	if len(tlsCert) <= 0 && len(tlsKey) <= 0 {
		slog.Info("Starting HTTP endpoint server", "port", port)
		go func() {
			if err := http.Serve(httpListener, httpMux); err != nil {
				slog.Error("Failed to start HTTP server", "err", err)
				ctxCancel()
			}
		}()
	} else if len(tlsCert) > 0 && len(tlsKey) > 0 {
		slog.Info("Starting HTTPS endpoint server", "port", port)
		go func() {
			if err := http.ServeTLS(httpListener, httpMux, tlsCert, tlsKey); err != nil {
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
	if common.GetFlags().Verbose {
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

	rel := GetRelay()
	// Get or create room in any case
	room := rel.GetOrCreateRoom(roomName)

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
	ws := connections.NewSafeWebSocket(wsConn)
	// Assign message handler for join request
	ws.RegisterMessageCallback("join", func(data []byte) {
		var joinMsg connections.MessageJoin
		if err = json.Unmarshal(data, &joinMsg); err != nil {
			slog.Error("Failed to unmarshal join message", "err", err)
			return
		}

		slog.Debug("Join message", "room", room.Name, "joinerType", joinMsg.JoinerType)

		// Handle join request, depending if it's from ingest/node or participant/client
		switch joinMsg.JoinerType {
		case connections.JoinerNode:
			// If room already online, send InUse answer
			if room.Online {
				if err = ws.SendAnswerMessageWS(connections.AnswerInUse); err != nil {
					slog.Error("Failed to send InUse answer to node", "room", room.Name, "err", err)
				}
				return
			}
			room.AssignWebSocket(ws)
			go IngestHandler(room)
		case connections.JoinerClient:
			// Create participant and add to room regardless of online status
			participant := NewParticipant(ws)
			room.AddParticipant(participant)
			// If room not online, send Offline answer
			if !room.Online {
				if err = ws.SendAnswerMessageWS(connections.AnswerOffline); err != nil {
					slog.Error("Failed to send offline answer to participant", "room", room.Name, "err", err)
				}
			}
			go ParticipantHandler(participant, room, rel)
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
	if len(authHeader) <= 0 || authHeader != common.GetFlags().ControlSecret {
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

	//relay := GetRelay()
	switch msg.Type {
	case "join_mesh":
		// Join the mesh network, get relay address from msg.Value
		if len(msg.Value) <= 0 {
			logHTTPError(w, "missing relay address", http.StatusBadRequest)
			return
		}
		ctx := r.Context()
		if err := GetRelay().ConnectToRelay(ctx, msg.Value); err != nil {
			http.Error(w, fmt.Sprintf("Failed to connect: %v", err), http.StatusInternalServerError)
			return
		}
		w.Write([]byte("Successfully connected to relay"))
	default:
		logHTTPError(w, "unknown control message type", http.StatusBadRequest)
	}
}
