import {LatencyTracker} from "./latency";

export interface MessageBase {
  payload_type: string;
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
