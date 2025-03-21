import { z } from "zod"

// Base message interface
export interface BaseMessage {
  type: string; // e.g., "start", "stop", "status"
  payload: Record<string, any>; // Generic payload, refined by specific types
}

// Specific message types
export interface StartMessage extends BaseMessage {
  type: "start";
  payload: {
    container_id: string;
    [key: string]: any; // Allow additional fields for future expansion
  };
}

// Example future message type
export interface StopMessage extends BaseMessage {
  type: "stop";
  payload: {
    container_id: string;
    [key: string]: any;
  };
}

// Union type for all possible messages (expandable)
export type MachineMessage = StartMessage | StopMessage; // Add more types as needed

// Zod schema for validation
export const BaseMessageSchema = z.object({
  type: z.string(),
  payload: z.record(z.any()),
});

export const CreateMessageSchema = BaseMessageSchema.extend({
  type: z.literal("create"),
});

export const StartMessageSchema = BaseMessageSchema.extend({
  type: z.literal("start"),
  payload: z.object({
    container_id: z.string(),
  }).passthrough(),
});

export const StopMessageSchema = BaseMessageSchema.extend({
  type: z.literal("stop"),
  payload: z.object({
    container_id: z.string(),
  }).passthrough(),
});

export const MachineMessageSchema = z.union([StartMessageSchema, StopMessageSchema]);