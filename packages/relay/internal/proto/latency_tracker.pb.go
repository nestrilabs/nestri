// Code generated by protoc-gen-go. DO NOT EDIT.
// versions:
// 	protoc-gen-go v1.36.6
// 	protoc        (unknown)
// source: latency_tracker.proto

package proto

import (
	protoreflect "google.golang.org/protobuf/reflect/protoreflect"
	protoimpl "google.golang.org/protobuf/runtime/protoimpl"
	timestamppb "google.golang.org/protobuf/types/known/timestamppb"
	reflect "reflect"
	sync "sync"
	unsafe "unsafe"
)

const (
	// Verify that this generated code is sufficiently up-to-date.
	_ = protoimpl.EnforceVersion(20 - protoimpl.MinVersion)
	// Verify that runtime/protoimpl is sufficiently up-to-date.
	_ = protoimpl.EnforceVersion(protoimpl.MaxVersion - 20)
)

type ProtoTimestampEntry struct {
	state         protoimpl.MessageState `protogen:"open.v1"`
	Stage         string                 `protobuf:"bytes,1,opt,name=stage,proto3" json:"stage,omitempty"`
	Time          *timestamppb.Timestamp `protobuf:"bytes,2,opt,name=time,proto3" json:"time,omitempty"`
	unknownFields protoimpl.UnknownFields
	sizeCache     protoimpl.SizeCache
}

func (x *ProtoTimestampEntry) Reset() {
	*x = ProtoTimestampEntry{}
	mi := &file_latency_tracker_proto_msgTypes[0]
	ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
	ms.StoreMessageInfo(mi)
}

func (x *ProtoTimestampEntry) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*ProtoTimestampEntry) ProtoMessage() {}

func (x *ProtoTimestampEntry) ProtoReflect() protoreflect.Message {
	mi := &file_latency_tracker_proto_msgTypes[0]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use ProtoTimestampEntry.ProtoReflect.Descriptor instead.
func (*ProtoTimestampEntry) Descriptor() ([]byte, []int) {
	return file_latency_tracker_proto_rawDescGZIP(), []int{0}
}

func (x *ProtoTimestampEntry) GetStage() string {
	if x != nil {
		return x.Stage
	}
	return ""
}

func (x *ProtoTimestampEntry) GetTime() *timestamppb.Timestamp {
	if x != nil {
		return x.Time
	}
	return nil
}

type ProtoLatencyTracker struct {
	state         protoimpl.MessageState `protogen:"open.v1"`
	SequenceId    string                 `protobuf:"bytes,1,opt,name=sequence_id,json=sequenceId,proto3" json:"sequence_id,omitempty"`
	Timestamps    []*ProtoTimestampEntry `protobuf:"bytes,2,rep,name=timestamps,proto3" json:"timestamps,omitempty"`
	unknownFields protoimpl.UnknownFields
	sizeCache     protoimpl.SizeCache
}

func (x *ProtoLatencyTracker) Reset() {
	*x = ProtoLatencyTracker{}
	mi := &file_latency_tracker_proto_msgTypes[1]
	ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
	ms.StoreMessageInfo(mi)
}

func (x *ProtoLatencyTracker) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*ProtoLatencyTracker) ProtoMessage() {}

func (x *ProtoLatencyTracker) ProtoReflect() protoreflect.Message {
	mi := &file_latency_tracker_proto_msgTypes[1]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use ProtoLatencyTracker.ProtoReflect.Descriptor instead.
func (*ProtoLatencyTracker) Descriptor() ([]byte, []int) {
	return file_latency_tracker_proto_rawDescGZIP(), []int{1}
}

func (x *ProtoLatencyTracker) GetSequenceId() string {
	if x != nil {
		return x.SequenceId
	}
	return ""
}

func (x *ProtoLatencyTracker) GetTimestamps() []*ProtoTimestampEntry {
	if x != nil {
		return x.Timestamps
	}
	return nil
}

var File_latency_tracker_proto protoreflect.FileDescriptor

const file_latency_tracker_proto_rawDesc = "" +
	"\n" +
	"\x15latency_tracker.proto\x12\x05proto\x1a\x1fgoogle/protobuf/timestamp.proto\"[\n" +
	"\x13ProtoTimestampEntry\x12\x14\n" +
	"\x05stage\x18\x01 \x01(\tR\x05stage\x12.\n" +
	"\x04time\x18\x02 \x01(\v2\x1a.google.protobuf.TimestampR\x04time\"r\n" +
	"\x13ProtoLatencyTracker\x12\x1f\n" +
	"\vsequence_id\x18\x01 \x01(\tR\n" +
	"sequenceId\x12:\n" +
	"\n" +
	"timestamps\x18\x02 \x03(\v2\x1a.proto.ProtoTimestampEntryR\n" +
	"timestampsB\x16Z\x14relay/internal/protob\x06proto3"

var (
	file_latency_tracker_proto_rawDescOnce sync.Once
	file_latency_tracker_proto_rawDescData []byte
)

func file_latency_tracker_proto_rawDescGZIP() []byte {
	file_latency_tracker_proto_rawDescOnce.Do(func() {
		file_latency_tracker_proto_rawDescData = protoimpl.X.CompressGZIP(unsafe.Slice(unsafe.StringData(file_latency_tracker_proto_rawDesc), len(file_latency_tracker_proto_rawDesc)))
	})
	return file_latency_tracker_proto_rawDescData
}

var file_latency_tracker_proto_msgTypes = make([]protoimpl.MessageInfo, 2)
var file_latency_tracker_proto_goTypes = []any{
	(*ProtoTimestampEntry)(nil),   // 0: proto.ProtoTimestampEntry
	(*ProtoLatencyTracker)(nil),   // 1: proto.ProtoLatencyTracker
	(*timestamppb.Timestamp)(nil), // 2: google.protobuf.Timestamp
}
var file_latency_tracker_proto_depIdxs = []int32{
	2, // 0: proto.ProtoTimestampEntry.time:type_name -> google.protobuf.Timestamp
	0, // 1: proto.ProtoLatencyTracker.timestamps:type_name -> proto.ProtoTimestampEntry
	2, // [2:2] is the sub-list for method output_type
	2, // [2:2] is the sub-list for method input_type
	2, // [2:2] is the sub-list for extension type_name
	2, // [2:2] is the sub-list for extension extendee
	0, // [0:2] is the sub-list for field type_name
}

func init() { file_latency_tracker_proto_init() }
func file_latency_tracker_proto_init() {
	if File_latency_tracker_proto != nil {
		return
	}
	type x struct{}
	out := protoimpl.TypeBuilder{
		File: protoimpl.DescBuilder{
			GoPackagePath: reflect.TypeOf(x{}).PkgPath(),
			RawDescriptor: unsafe.Slice(unsafe.StringData(file_latency_tracker_proto_rawDesc), len(file_latency_tracker_proto_rawDesc)),
			NumEnums:      0,
			NumMessages:   2,
			NumExtensions: 0,
			NumServices:   0,
		},
		GoTypes:           file_latency_tracker_proto_goTypes,
		DependencyIndexes: file_latency_tracker_proto_depIdxs,
		MessageInfos:      file_latency_tracker_proto_msgTypes,
	}.Build()
	File_latency_tracker_proto = out.File
	file_latency_tracker_proto_goTypes = nil
	file_latency_tracker_proto_depIdxs = nil
}
