// @generated by protoc-gen-es v2.2.3 with parameter "target=ts"
// @generated from file latency_tracker.proto (package proto, syntax proto3)
/* eslint-disable */

import type { GenFile, GenMessage } from "@bufbuild/protobuf/codegenv1";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv1";
import type { Any, Timestamp } from "@bufbuild/protobuf/wkt";
import { file_google_protobuf_any, file_google_protobuf_timestamp } from "@bufbuild/protobuf/wkt";
import type { Message } from "@bufbuild/protobuf";

/**
 * Describes the file latency_tracker.proto.
 */
export const file_latency_tracker: GenFile = /*@__PURE__*/
  fileDesc("ChVsYXRlbmN5X3RyYWNrZXIucHJvdG8SBXByb3RvIk4KE1Byb3RvVGltZXN0YW1wRW50cnkSDQoFc3RhZ2UYASABKAkSKAoEdGltZRgCIAEoCzIaLmdvb2dsZS5wcm90b2J1Zi5UaW1lc3RhbXAi3QEKE1Byb3RvTGF0ZW5jeVRyYWNrZXISEwoLc2VxdWVuY2VfaWQYASABKAkSLgoKdGltZXN0YW1wcxgCIAMoCzIaLnByb3RvLlByb3RvVGltZXN0YW1wRW50cnkSOgoIbWV0YWRhdGEYAyADKAsyKC5wcm90by5Qcm90b0xhdGVuY3lUcmFja2VyLk1ldGFkYXRhRW50cnkaRQoNTWV0YWRhdGFFbnRyeRILCgNrZXkYASABKAkSIwoFdmFsdWUYAiABKAsyFC5nb29nbGUucHJvdG9idWYuQW55OgI4AWIGcHJvdG8z", [file_google_protobuf_any, file_google_protobuf_timestamp]);

/**
 * @generated from message proto.ProtoTimestampEntry
 */
export type ProtoTimestampEntry = Message<"proto.ProtoTimestampEntry"> & {
  /**
   * @generated from field: string stage = 1;
   */
  stage: string;

  /**
   * @generated from field: google.protobuf.Timestamp time = 2;
   */
  time?: Timestamp;
};

/**
 * Describes the message proto.ProtoTimestampEntry.
 * Use `create(ProtoTimestampEntrySchema)` to create a new message.
 */
export const ProtoTimestampEntrySchema: GenMessage<ProtoTimestampEntry> = /*@__PURE__*/
  messageDesc(file_latency_tracker, 0);

/**
 * @generated from message proto.ProtoLatencyTracker
 */
export type ProtoLatencyTracker = Message<"proto.ProtoLatencyTracker"> & {
  /**
   * @generated from field: string sequence_id = 1;
   */
  sequenceId: string;

  /**
   * @generated from field: repeated proto.ProtoTimestampEntry timestamps = 2;
   */
  timestamps: ProtoTimestampEntry[];

  /**
   * @generated from field: map<string, google.protobuf.Any> metadata = 3;
   */
  metadata: { [key: string]: Any };
};

/**
 * Describes the message proto.ProtoLatencyTracker.
 * Use `create(ProtoLatencyTrackerSchema)` to create a new message.
 */
export const ProtoLatencyTrackerSchema: GenMessage<ProtoLatencyTracker> = /*@__PURE__*/
  messageDesc(file_latency_tracker, 1);

