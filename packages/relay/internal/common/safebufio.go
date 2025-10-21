package common

import (
	"bufio"
	"encoding/binary"
	"errors"
	"io"
	gen "relay/internal/proto"
	"sync"

	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// readUvarint reads an unsigned varint from the reader
func readUvarint(r io.ByteReader) (uint64, error) {
	return binary.ReadUvarint(r)
}

// writeUvarint writes an unsigned varint to the writer
func writeUvarint(w io.Writer, x uint64) error {
	buf := make([]byte, binary.MaxVarintLen64)
	n := binary.PutUvarint(buf, x)
	_, err := w.Write(buf[:n])
	return err
}

// SafeBufioRW wraps a bufio.ReadWriter for sending and receiving JSON and protobufs safely
type SafeBufioRW struct {
	brw   *bufio.ReadWriter
	mutex sync.RWMutex
}

func NewSafeBufioRW(brw *bufio.ReadWriter) *SafeBufioRW {
	return &SafeBufioRW{brw: brw}
}

func (bu *SafeBufioRW) SendProto(msg proto.Message) error {
	bu.mutex.Lock()
	defer bu.mutex.Unlock()

	protoData, err := proto.Marshal(msg)
	if err != nil {
		return err
	}

	// Write varint length prefix
	if err := writeUvarint(bu.brw, uint64(len(protoData))); err != nil {
		return err
	}

	// Write the Protobuf data
	if _, err := bu.brw.Write(protoData); err != nil {
		return err
	}

	return bu.brw.Flush()
}

func (bu *SafeBufioRW) ReceiveProto(msg proto.Message) error {
	bu.mutex.RLock()
	defer bu.mutex.RUnlock()

	// Read varint length prefix
	length, err := readUvarint(bu.brw)
	if err != nil {
		return err
	}

	// Read the Protobuf data
	data := make([]byte, length)
	if _, err := io.ReadFull(bu.brw, data); err != nil {
		return err
	}

	return proto.Unmarshal(data, msg)
}

type CreateMessageOptions struct {
	SequenceID string
	Latency    *gen.ProtoLatencyTracker
}

func CreateMessage(payload proto.Message, payloadType string, opts *CreateMessageOptions) (*gen.ProtoMessage, error) {
	msg := &gen.ProtoMessage{
		MessageBase: &gen.ProtoMessageBase{
			PayloadType: payloadType,
		},
	}

	if opts != nil {
		if opts.Latency != nil {
			msg.MessageBase.Latency = opts.Latency
		} else if opts.SequenceID != "" {
			msg.MessageBase.Latency = &gen.ProtoLatencyTracker{
				SequenceId: opts.SequenceID,
				Timestamps: []*gen.ProtoTimestampEntry{
					{
						Stage: "created",
						Time:  timestamppb.Now(),
					},
				},
			}
		}
	}

	// Use reflection to set the oneof field automatically
	msgReflect := msg.ProtoReflect()
	payloadReflect := payload.ProtoReflect()

	oneofDesc := msgReflect.Descriptor().Oneofs().ByName("payload")
	if oneofDesc == nil {
		return nil, errors.New("payload oneof not found")
	}

	fields := oneofDesc.Fields()
	for i := 0; i < fields.Len(); i++ {
		field := fields.Get(i)
		if field.Message() != nil && field.Message().FullName() == payloadReflect.Descriptor().FullName() {
			msgReflect.Set(field, protoreflect.ValueOfMessage(payloadReflect))
			return msg, nil
		}
	}

	return nil, errors.New("payload type not found in oneof")
}
