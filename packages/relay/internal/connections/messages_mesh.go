package connections

import (
	"github.com/pion/webrtc/v4"
	"google.golang.org/protobuf/proto"
	gen "relay/internal/proto"
)

// SendMeshHandshake sends a handshake message to another relay.
func (ws *SafeWebSocket) SendMeshHandshake(relayID, publicKey string) error {
	msg := &gen.MeshMessage{
		Type: &gen.MeshMessage_Handshake{
			Handshake: &gen.Handshake{
				RelayId:     relayID,
				DhPublicKey: publicKey,
			},
		},
	}
	data, err := proto.Marshal(msg)
	if err != nil {
		return err
	}
	return ws.SendBinary(data)
}

// SendMeshHandshakeResponse sends a handshake response to a relay.
func (ws *SafeWebSocket) SendMeshHandshakeResponse(relayID, dhPublicKey string, approvals map[string]string) error {
	msg := &gen.MeshMessage{
		Type: &gen.MeshMessage_HandshakeResponse{
			HandshakeResponse: &gen.HandshakeResponse{
				RelayId:     relayID,
				DhPublicKey: dhPublicKey,
				Approvals:   approvals,
			},
		},
	}
	data, err := proto.Marshal(msg)
	if err != nil {
		return err
	}
	return ws.SendBinary(data)
}

// SendMeshForwardSDP sends a forwarded SDP message to another relay
func (ws *SafeWebSocket) SendMeshForwardSDP(roomName, participantID string, sdp webrtc.SessionDescription) error {
	msg := &gen.MeshMessage{
		Type: &gen.MeshMessage_ForwardSdp{
			ForwardSdp: &gen.ForwardSDP{
				RoomName:      roomName,
				ParticipantId: participantID,
				Sdp:           sdp.SDP,
				Type:          sdp.Type.String(),
			},
		},
	}
	data, err := proto.Marshal(msg)
	if err != nil {
		return err
	}
	return ws.SendBinary(data)
}

// SendMeshForwardICE sends a forwarded ICE candidate to another relay
func (ws *SafeWebSocket) SendMeshForwardICE(roomName, participantID string, candidate webrtc.ICECandidateInit) error {
	var sdpMLineIndex uint32
	if candidate.SDPMLineIndex != nil {
		sdpMLineIndex = uint32(*candidate.SDPMLineIndex)
	}

	msg := &gen.MeshMessage{
		Type: &gen.MeshMessage_ForwardIce{
			ForwardIce: &gen.ForwardICE{
				RoomName:      roomName,
				ParticipantId: participantID,
				Candidate: &gen.ICECandidateInit{
					Candidate:        candidate.Candidate,
					SdpMid:           candidate.SDPMid,
					SdpMLineIndex:    &sdpMLineIndex,
					UsernameFragment: candidate.UsernameFragment,
				},
			},
		},
	}
	data, err := proto.Marshal(msg)
	if err != nil {
		return err
	}
	return ws.SendBinary(data)
}

func (ws *SafeWebSocket) SendMeshForwardIngest(roomName string) error {
	msg := &gen.MeshMessage{
		Type: &gen.MeshMessage_ForwardIngest{
			ForwardIngest: &gen.ForwardIngest{
				RoomName: roomName,
			},
		},
	}
	data, err := proto.Marshal(msg)
	if err != nil {
		return err
	}
	return ws.SendBinary(data)
}

func (ws *SafeWebSocket) SendMeshStreamRequest(roomName string) error {
	msg := &gen.MeshMessage{
		Type: &gen.MeshMessage_StreamRequest{
			StreamRequest: &gen.StreamRequest{
				RoomName: roomName,
			},
		},
	}
	data, err := proto.Marshal(msg)
	if err != nil {
		return err
	}
	return ws.SendBinary(data)
}
