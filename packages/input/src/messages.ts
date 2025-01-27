import {gzip, ungzip} from "pako";
import {type Input} from "./types"
import {LatencyTracker} from "./latency";
import { ProtoInput, ProtoKeyDown, ProtoBaseInput, ProtoKeyUp, ProtoMouseKeyDown, ProtoMouseKeyUp, ProtoMouseMove, ProtoMouseMoveAbs, ProtoMouseWheel } from "./proto/types_pb"
import { ProtoMessageBase, ProtoMessageInput, ProtoMessageInputSchema } from "./proto/messages_pb";
import { toBinary } from "@bufbuild/protobuf";


export interface MessageBase {
  payload_type: string;
}

export interface MessageInput extends MessageBase {
  payload_type: "input";
  data: Input;
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

export function encodeBaseInput(message: MessageBase): Uint8Array {
  if(message.payload_type === "input") {
    const inputMessage : MessageInput = message as MessageInput
    const messageBase : ProtoMessageBase = {
      $typeName: "proto.ProtoMessageBase",
      payloadType: "input"
    }

    var base : ProtoBaseInput = {
      $typeName: "proto.ProtoBaseInput",
      timestamp: BigInt(0)
    }

    if(inputMessage.data.timestamp) {
      base = {
        $typeName: "proto.ProtoBaseInput",
        timestamp: BigInt(inputMessage.data.timestamp)
      }
    }
    var protoInput : ProtoInput
    switch(inputMessage.data.type) {
      case "KeyDown": {
        const keyDown : ProtoKeyDown = {
          $typeName: "proto.ProtoKeyDown",
          baseInput: base,
          type: "keyDown",
          key: inputMessage.data.key
        }

        protoInput = {
          $typeName: "proto.ProtoInput",
          inputType: {case: "keyDown", value: keyDown}
        }

        break;
      }
      case "KeyUp": {
        const keyUp : ProtoKeyUp = {
          $typeName: "proto.ProtoKeyUp",
          baseInput: base,
          type: "keyDown",
          key: inputMessage.data.key
        }

        protoInput = {
          $typeName: "proto.ProtoInput",
          inputType: {case: "keyUp", value: keyUp}
        }

        break;
      }
      case "MouseKeyDown": {
        const mouseKeyDown : ProtoMouseKeyDown = {
          $typeName: "proto.ProtoMouseKeyDown",
          baseInput: base,
          type: "mouseKeyDown",
          key: inputMessage.data.key
        }

        protoInput = {
          $typeName: "proto.ProtoInput",
          inputType: {case: "mouseKeyDown", value: mouseKeyDown}
        }

        break;
      }
      case "MouseKeyUp": {
        const mouseKeyUp : ProtoMouseKeyUp = {
          $typeName: "proto.ProtoMouseKeyUp",
          baseInput: base,
          type: "mouseKeyUp",
          key: inputMessage.data.key
        }

        protoInput = {
          $typeName: "proto.ProtoInput",
          inputType: {case: "mouseKeyUp", value: mouseKeyUp}
        }

        break;
      }
      case "MouseMove": {
        const mouseMove : ProtoMouseMove = {
          $typeName: "proto.ProtoMouseMove",
          baseInput: base,
          type: "mouseMove",
          x: inputMessage.data.x,
          y: inputMessage.data.y
        }

        protoInput = {
          $typeName: "proto.ProtoInput",
          inputType: {case: "mouseMove", value: mouseMove}
        }

        break;
      }
      case "MouseMoveAbs": {
        const mouseMoveAbs : ProtoMouseMoveAbs = {
          $typeName: "proto.ProtoMouseMoveAbs",
          baseInput: base,
          type: "mouseMoveAbs",
          x: inputMessage.data.x,
          y: inputMessage.data.y
        }

        protoInput = { 
          $typeName: "proto.ProtoInput",
          inputType: {case: "mouseMoveAbs", value: mouseMoveAbs}
        }

        break;
      }
      case "MouseWheel": {
        const mouseWheel : ProtoMouseWheel = {
          $typeName: "proto.ProtoMouseWheel",
          baseInput: base,
          type: "mouseWheel",
          x: inputMessage.data.x,
          y: inputMessage.data.y
        }

        protoInput = { 
          $typeName: "proto.ProtoInput",
          inputType: {case: "mouseWheel", value: mouseWheel}
        }

        break;
      }

      
      
    } 

    const protoMessage : ProtoMessageInput = {
      $typeName: "proto.ProtoMessageInput",
      messageBase: messageBase,
      data: protoInput
    }

    return toBinary(ProtoMessageInputSchema, protoMessage)
  } else {
    return encodeMessage(message)
  }

}
