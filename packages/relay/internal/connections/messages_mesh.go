package connections

import (
	"github.com/pion/webrtc/v4"
)

// MessageMeshHandshake is sent when a relay connects to another mesh relay.
type MessageMeshHandshake struct {
	MessageBase
	RelayID     string `json:"relay_id"`
	DHPublicKey string `json:"dh_public_key"` // base64 encoded Diffie-Hellman public key
}

// MessageMeshHandshakeResponse is sent back after a successful handshake.
type MessageMeshHandshakeResponse struct {
	MessageBase
	RelayID     string            `json:"relay_id"`
	DHPublicKey string            `json:"dh_public_key"`
	Approvals   map[string]string `json:"approvals"` // RelayID -> Signature
}

// MessageMeshStreamRequest is sent to request a stream from another mesh relay
type MessageMeshStreamRequest struct {
	MessageBase
	RoomName string `json:"room_name"`
}

// MessageMeshForwardSDP is used to relay SDP messages between mesh relays
type MessageMeshForwardSDP struct {
	MessageBase
	RoomName      string                    `json:"room_name,omitempty"`
	ParticipantID string                    `json:"participant_id,omitempty"`
	SDP           webrtc.SessionDescription `json:"sdp"`
}

// MessageMeshForwardICE is used to relay ICE candidates between mesh relays
type MessageMeshForwardICE struct {
	MessageBase
	RoomName      string                  `json:"room_name"`
	ParticipantID string                  `json:"participant_id"`
	Candidate     webrtc.ICECandidateInit `json:"candidate"`
}

// MessageMeshForwardIngest is used to forward ingest to another mesh relay
type MessageMeshForwardIngest struct {
	MessageBase
	RoomName string `json:"room_name"`
}

type MessageMeshStateChange struct {
	MessageBase
	Action   string `json:"action"` // "add", "remove"..
	RoomName string `json:"roomName"`
}

// SendMeshHandshake sends a handshake message to another relay.
func (ws *SafeWebSocket) SendMeshHandshake(relayID, publicKey string) error {
	msg := MessageMeshHandshake{
		MessageBase: MessageBase{PayloadType: "mesh_handshake"},
		RelayID:     relayID,
		DHPublicKey: publicKey,
	}
	return ws.SendJSON(msg)
}

// SendMeshHandshakeResponse sends a handshake response to a relay.
func (ws *SafeWebSocket) SendMeshHandshakeResponse(relayID, dhPublicKey string, approvals map[string]string) error {
	msg := MessageMeshHandshakeResponse{
		MessageBase: MessageBase{PayloadType: "mesh_handshake_response"},
		RelayID:     relayID,
		DHPublicKey: dhPublicKey,
		Approvals:   approvals,
	}
	return ws.SendJSON(msg)
}

// SendMeshStreamRequest sends a stream request to another relay
func (ws *SafeWebSocket) SendMeshStreamRequest(roomName string) error {
	msg := MessageMeshStreamRequest{
		MessageBase: MessageBase{PayloadType: "mesh_stream_request"},
		RoomName:    roomName,
	}
	return ws.SendJSON(msg)
}

// SendMeshForwardSDP sends a forwarded SDP message to another relay
func (ws *SafeWebSocket) SendMeshForwardSDP(roomName, participantID string, sdp webrtc.SessionDescription) error {
	msg := MessageMeshForwardSDP{
		MessageBase:   MessageBase{PayloadType: "mesh_forward_sdp"},
		RoomName:      roomName,
		ParticipantID: participantID,
		SDP:           sdp,
	}
	return ws.SendJSON(msg)
}

// SendMeshForwardICE sends a forwarded ICE candidate to another relay
func (ws *SafeWebSocket) SendMeshForwardICE(roomName, participantID string, candidate webrtc.ICECandidateInit) error {
	msg := MessageMeshForwardICE{
		MessageBase:   MessageBase{PayloadType: "mesh_forward_ice"},
		RoomName:      roomName,
		ParticipantID: participantID,
		Candidate:     candidate,
	}
	return ws.SendJSON(msg)
}

func (ws *SafeWebSocket) SendMeshForwardIngest(roomName string) error {
	msg := MessageMeshForwardIngest{
		MessageBase: MessageBase{PayloadType: "mesh_forward_ingest"},
		RoomName:    roomName,
	}
	return ws.SendJSON(msg)
}

func (ws *SafeWebSocket) SendMeshStateChange(action string, roomName string) error {
	msg := MessageMeshStateChange{
		MessageBase: MessageBase{PayloadType: "mesh_state_change"},
		Action:      action,
		RoomName:    roomName,
	}
	return ws.SendJSON(msg)
}
