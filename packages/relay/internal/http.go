package relay

import (
	"github.com/gorilla/websocket"
	"log"
	"net/http"
	"strconv"
)

var httpMux *http.ServeMux

func InitHTTPEndpoint() {
	// Create HTTP mux which serves our WS endpoint
	httpMux = http.NewServeMux()

	// Endpoints themselves
	httpMux.Handle("/", http.NotFoundHandler())
	httpMux.HandleFunc("/api/ws/{roomName}", corsAnyHandler(wsHandler))

	// Get our serving port
	port := GetFlags().EndpointPort

	// Log and start the endpoint server
	log.Println("Starting HTTP endpoint server on :", strconv.Itoa(port))
	go func() {
		log.Fatal((&http.Server{
			Handler: httpMux,
			Addr:    ":" + strconv.Itoa(port),
		}).ListenAndServe())
	}()
}

// logHTTPError logs (if verbose) and sends an error code to requester
func logHTTPError(w http.ResponseWriter, err string, code int) {
	if GetFlags().Verbose {
		log.Println(err)
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
		if err = DecodeMessage(data, &joinMsg); err != nil {
			log.Printf("Failed to decode join message: %s\n", err)
			return
		}

		if GetFlags().Verbose {
			log.Printf("Join request for room: '%s' from: '%s'\n", room.Name, joinMsg.JoinerType.String())
		}

		// Handle join request, depending if it's from ingest/node or participant/client
		switch joinMsg.JoinerType {
		case JoinerNode:
			// If room already online, send InUse answer
			if room.Online {
				if err = ws.SendAnswerMessageWS(AnswerInUse); err != nil {
					log.Printf("Failed to send InUse answer for Room: '%s' - reason: %s\n", room.Name, err)
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
					log.Printf("Failed to send Offline answer for Room: '%s' - reason: %s\n", room.Name, err)
				}
			}
			go participantHandler(participant, room)
		default:
			log.Printf("Unknown joiner type: %d\n", joinMsg.JoinerType)
		}

		// Unregister ourselves, if something happens on the other side they should just reconnect?
		ws.UnregisterMessageCallback("join")
	})
}
