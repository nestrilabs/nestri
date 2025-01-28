import {gzip, ungzip} from "pako";
import {LatencyTracker} from "./latency";

export interface MessageBase {
  payload_type: string;
}

export interface MessageInput extends MessageBase {
  payload_type: "input";
  data: string;
  latency?: LatencyTracker;
}

export interface MessageICE extends MessageBase {
  payload_type: "ice";
  candidate: RTCIceCandidateInit;
}

export interface MessageSDP extends MessageBase {
  payload_type: "sdp";
  sdp: RTCSessionDescriptionInit;
}

export enum JoinerType {
  JoinerNode = 0,
  JoinerClient = 1,
}

export interface MessageJoin extends MessageBase {
  payload_type: "join";
  joiner_type: JoinerType;
}

export enum AnswerType {
  AnswerOffline = 0,
  AnswerInUse,
  AnswerOK
}

export interface MessageAnswer extends MessageBase {
  payload_type: "answer";
  answer_type: AnswerType;
}

function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const arrayBuffer = reader.result as ArrayBuffer;
      resolve(new Uint8Array(arrayBuffer));
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
}

export function encodeMessage<T>(message: T): Uint8Array {
  // Convert the message to JSON string
  const json = JSON.stringify(message);
  // Compress the JSON string using gzip
  return gzip(json);
}

export async function decodeMessage<T>(data: Blob): Promise<T> {
  // Convert the Blob to Uint8Array
  const array = await blobToUint8Array(data);
  // Decompress the gzip data
  const decompressed = ungzip(array);
  // Convert the Uint8Array to JSON string
  const json = new TextDecoder().decode(decompressed);
  // Parse the JSON string
  return JSON.parse(json);
}
