package common

import (
	"bufio"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"sync"

	"google.golang.org/protobuf/proto"
)

// MaxSize is the maximum allowed data size (1MB)
const MaxSize = 1024 * 1024

// SafeBufioRW wraps a bufio.ReadWriter for sending and receiving JSON and protobufs safely
type SafeBufioRW struct {
	brw   *bufio.ReadWriter
	mutex sync.RWMutex
}

func NewSafeBufioRW(brw *bufio.ReadWriter) *SafeBufioRW {
	return &SafeBufioRW{brw: brw}
}

// SendJSON serializes the given data as JSON and sends it with a 4-byte length prefix
func (bu *SafeBufioRW) SendJSON(data interface{}) error {
	bu.mutex.Lock()
	defer bu.mutex.Unlock()

	jsonData, err := json.Marshal(data)
	if err != nil {
		return err
	}

	if len(jsonData) > MaxSize {
		return errors.New("JSON data exceeds maximum size")
	}

	// Write the 4-byte length prefix
	if err = binary.Write(bu.brw, binary.BigEndian, uint32(len(jsonData))); err != nil {
		return err
	}

	// Write the JSON data
	if _, err = bu.brw.Write(jsonData); err != nil {
		return err
	}

	// Flush the writer to ensure data is sent
	return bu.brw.Flush()
}

// ReceiveJSON reads a 4-byte length prefix, then reads and unmarshals the JSON
func (bu *SafeBufioRW) ReceiveJSON(dest interface{}) error {
	bu.mutex.RLock()
	defer bu.mutex.RUnlock()

	// Read the 4-byte length prefix
	var length uint32
	if err := binary.Read(bu.brw, binary.BigEndian, &length); err != nil {
		return err
	}

	if length > MaxSize {
		return errors.New("received JSON data exceeds maximum size")
	}

	// Read the JSON data
	data := make([]byte, length)
	if _, err := io.ReadFull(bu.brw, data); err != nil {
		return err
	}

	return json.Unmarshal(data, dest)
}

// Receive reads a 4-byte length prefix, then reads the raw data
func (bu *SafeBufioRW) Receive() ([]byte, error) {
	bu.mutex.RLock()
	defer bu.mutex.RUnlock()

	// Read the 4-byte length prefix
	var length uint32
	if err := binary.Read(bu.brw, binary.BigEndian, &length); err != nil {
		return nil, err
	}

	if length > MaxSize {
		return nil, errors.New("received data exceeds maximum size")
	}

	// Read the raw data
	data := make([]byte, length)
	if _, err := io.ReadFull(bu.brw, data); err != nil {
		return nil, err
	}

	return data, nil
}

// SendProto serializes the given protobuf message and sends it with a 4-byte length prefix
func (bu *SafeBufioRW) SendProto(msg proto.Message) error {
	bu.mutex.Lock()
	defer bu.mutex.Unlock()

	protoData, err := proto.Marshal(msg)
	if err != nil {
		return err
	}

	if len(protoData) > MaxSize {
		return errors.New("protobuf data exceeds maximum size")
	}

	// Write the 4-byte length prefix
	if err = binary.Write(bu.brw, binary.BigEndian, uint32(len(protoData))); err != nil {
		return err
	}

	// Write the Protobuf data
	if _, err := bu.brw.Write(protoData); err != nil {
		return err
	}

	// Flush the writer to ensure data is sent
	return bu.brw.Flush()
}

// ReceiveProto reads a 4-byte length prefix, then reads and unmarshals the protobuf
func (bu *SafeBufioRW) ReceiveProto(msg proto.Message) error {
	bu.mutex.RLock()
	defer bu.mutex.RUnlock()

	// Read the 4-byte length prefix
	var length uint32
	if err := binary.Read(bu.brw, binary.BigEndian, &length); err != nil {
		return err
	}

	if length > MaxSize {
		return errors.New("received Protobuf data exceeds maximum size")
	}

	// Read the Protobuf data
	data := make([]byte, length)
	if _, err := io.ReadFull(bu.brw, data); err != nil {
		return err
	}

	return proto.Unmarshal(data, msg)
}

// Write writes raw data to the underlying buffer
func (bu *SafeBufioRW) Write(data []byte) (int, error) {
	bu.mutex.Lock()
	defer bu.mutex.Unlock()

	if len(data) > MaxSize {
		return 0, errors.New("data exceeds maximum size")
	}

	n, err := bu.brw.Write(data)
	if err != nil {
		return n, err
	}

	// Flush the writer to ensure data is sent
	if err = bu.brw.Flush(); err != nil {
		return n, err
	}

	return n, nil
}
