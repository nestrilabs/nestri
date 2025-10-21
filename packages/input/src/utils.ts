import { create, toBinary, fromBinary } from "@bufbuild/protobuf";
import type { Message } from "@bufbuild/protobuf";
import { Uint8ArrayList } from "uint8arraylist";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  ProtoLatencyTracker,
  ProtoLatencyTrackerSchema,
  ProtoTimestampEntrySchema,
} from "./proto/latency_tracker_pb";
import {
  ProtoMessage,
  ProtoMessageSchema,
  ProtoMessageBaseSchema,
} from "./proto/messages_pb";

export function bufbuildAdapter<T extends Message>(schema: GenMessage<T>) {
  return {
    encode: (data: T): Uint8Array => {
      return toBinary(schema, data);
    },
    decode: (data: Uint8Array | Uint8ArrayList): T => {
      // Convert Uint8ArrayList to Uint8Array if needed
      const bytes = data instanceof Uint8ArrayList ? data.subarray() : data;
      return fromBinary(schema, bytes);
    },
  };
}

// Latency tracker helpers
export function createLatencyTracker(sequenceId?: string): ProtoLatencyTracker {
  return create(ProtoLatencyTrackerSchema, {
    sequenceId: sequenceId || crypto.randomUUID(),
    timestamps: [],
  });
}

export function addLatencyTimestamp(
  tracker: ProtoLatencyTracker,
  stage: string,
): ProtoLatencyTracker {
  const entry = create(ProtoTimestampEntrySchema, {
    stage,
    time: timestampFromDate(new Date()),
  });

  return {
    ...tracker,
    timestamps: [...tracker.timestamps, entry],
  };
}

interface CreateMessageOptions {
  sequenceId?: string;
}

function derivePayloadCase(data: Message): string {
  // Extract case from $typeName: "proto.ProtoICE" -> "ice"
  // "proto.ProtoControllerAttach" -> "controllerAttach"
  const typeName = data.$typeName;
  if (!typeName)
    throw new Error("Message has no $typeName");

  // Remove "proto.Proto" prefix and convert first char to lowercase
  const caseName = typeName.replace(/^proto\.Proto/, "");

  // Convert PascalCase to camelCase
  // If it's all caps (like SDP, ICE), lowercase everything
  // Otherwise, just lowercase the first character
  if (caseName === caseName.toUpperCase()) {
    return caseName.toLowerCase();
  }
  return caseName.charAt(0).toLowerCase() + caseName.slice(1);
}

export function createMessage(
  data: Message,
  payloadType: string,
  options?: CreateMessageOptions,
): ProtoMessage {
  const payloadCase = derivePayloadCase(data);

  return create(ProtoMessageSchema, {
    messageBase: create(ProtoMessageBaseSchema, {
      payloadType,
      latency: options?.sequenceId
        ? createLatencyTracker(options.sequenceId)
        : undefined,
    }),
    payload: {
      case: payloadCase,
      value: data,
    } as any, // Type assertion needed for dynamic case
  });
}
