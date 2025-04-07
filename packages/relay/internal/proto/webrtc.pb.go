// Code generated by protoc-gen-go. DO NOT EDIT.
// versions:
// 	protoc-gen-go v1.36.6
// 	protoc        (unknown)
// source: webrtc.proto

package proto

import (
	protoreflect "google.golang.org/protobuf/reflect/protoreflect"
	protoimpl "google.golang.org/protobuf/runtime/protoimpl"
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

type ICECandidateInit struct {
	state            protoimpl.MessageState `protogen:"open.v1"`
	Candidate        string                 `protobuf:"bytes,1,opt,name=candidate,proto3" json:"candidate,omitempty"`
	SdpMid           *string                `protobuf:"bytes,2,opt,name=sdp_mid,json=sdpMid,proto3,oneof" json:"sdp_mid,omitempty"`
	SdpMLineIndex    *uint32                `protobuf:"varint,3,opt,name=sdp_m_line_index,json=sdpMLineIndex,proto3,oneof" json:"sdp_m_line_index,omitempty"`
	UsernameFragment *string                `protobuf:"bytes,4,opt,name=username_fragment,json=usernameFragment,proto3,oneof" json:"username_fragment,omitempty"`
	unknownFields    protoimpl.UnknownFields
	sizeCache        protoimpl.SizeCache
}

func (x *ICECandidateInit) Reset() {
	*x = ICECandidateInit{}
	mi := &file_webrtc_proto_msgTypes[0]
	ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
	ms.StoreMessageInfo(mi)
}

func (x *ICECandidateInit) String() string {
	return protoimpl.X.MessageStringOf(x)
}

func (*ICECandidateInit) ProtoMessage() {}

func (x *ICECandidateInit) ProtoReflect() protoreflect.Message {
	mi := &file_webrtc_proto_msgTypes[0]
	if x != nil {
		ms := protoimpl.X.MessageStateOf(protoimpl.Pointer(x))
		if ms.LoadMessageInfo() == nil {
			ms.StoreMessageInfo(mi)
		}
		return ms
	}
	return mi.MessageOf(x)
}

// Deprecated: Use ICECandidateInit.ProtoReflect.Descriptor instead.
func (*ICECandidateInit) Descriptor() ([]byte, []int) {
	return file_webrtc_proto_rawDescGZIP(), []int{0}
}

func (x *ICECandidateInit) GetCandidate() string {
	if x != nil {
		return x.Candidate
	}
	return ""
}

func (x *ICECandidateInit) GetSdpMid() string {
	if x != nil && x.SdpMid != nil {
		return *x.SdpMid
	}
	return ""
}

func (x *ICECandidateInit) GetSdpMLineIndex() uint32 {
	if x != nil && x.SdpMLineIndex != nil {
		return *x.SdpMLineIndex
	}
	return 0
}

func (x *ICECandidateInit) GetUsernameFragment() string {
	if x != nil && x.UsernameFragment != nil {
		return *x.UsernameFragment
	}
	return ""
}

var File_webrtc_proto protoreflect.FileDescriptor

const file_webrtc_proto_rawDesc = "" +
	"\n" +
	"\fwebrtc.proto\x12\x05proto\"\xe5\x01\n" +
	"\x10ICECandidateInit\x12\x1c\n" +
	"\tcandidate\x18\x01 \x01(\tR\tcandidate\x12\x1c\n" +
	"\asdp_mid\x18\x02 \x01(\tH\x00R\x06sdpMid\x88\x01\x01\x12,\n" +
	"\x10sdp_m_line_index\x18\x03 \x01(\rH\x01R\rsdpMLineIndex\x88\x01\x01\x120\n" +
	"\x11username_fragment\x18\x04 \x01(\tH\x02R\x10usernameFragment\x88\x01\x01B\n" +
	"\n" +
	"\b_sdp_midB\x13\n" +
	"\x11_sdp_m_line_indexB\x14\n" +
	"\x12_username_fragmentB\x16Z\x14relay/internal/protob\x06proto3"

var (
	file_webrtc_proto_rawDescOnce sync.Once
	file_webrtc_proto_rawDescData []byte
)

func file_webrtc_proto_rawDescGZIP() []byte {
	file_webrtc_proto_rawDescOnce.Do(func() {
		file_webrtc_proto_rawDescData = protoimpl.X.CompressGZIP(unsafe.Slice(unsafe.StringData(file_webrtc_proto_rawDesc), len(file_webrtc_proto_rawDesc)))
	})
	return file_webrtc_proto_rawDescData
}

var file_webrtc_proto_msgTypes = make([]protoimpl.MessageInfo, 1)
var file_webrtc_proto_goTypes = []any{
	(*ICECandidateInit)(nil), // 0: proto.ICECandidateInit
}
var file_webrtc_proto_depIdxs = []int32{
	0, // [0:0] is the sub-list for method output_type
	0, // [0:0] is the sub-list for method input_type
	0, // [0:0] is the sub-list for extension type_name
	0, // [0:0] is the sub-list for extension extendee
	0, // [0:0] is the sub-list for field type_name
}

func init() { file_webrtc_proto_init() }
func file_webrtc_proto_init() {
	if File_webrtc_proto != nil {
		return
	}
	file_webrtc_proto_msgTypes[0].OneofWrappers = []any{}
	type x struct{}
	out := protoimpl.TypeBuilder{
		File: protoimpl.DescBuilder{
			GoPackagePath: reflect.TypeOf(x{}).PkgPath(),
			RawDescriptor: unsafe.Slice(unsafe.StringData(file_webrtc_proto_rawDesc), len(file_webrtc_proto_rawDesc)),
			NumEnums:      0,
			NumMessages:   1,
			NumExtensions: 0,
			NumServices:   0,
		},
		GoTypes:           file_webrtc_proto_goTypes,
		DependencyIndexes: file_webrtc_proto_depIdxs,
		MessageInfos:      file_webrtc_proto_msgTypes,
	}.Build()
	File_webrtc_proto = out.File
	file_webrtc_proto_goTypes = nil
	file_webrtc_proto_depIdxs = nil
}
