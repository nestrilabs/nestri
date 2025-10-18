import {keyCodeToLinuxEventCode} from "./codes"
import {WebRTCStream} from "./webrtc-stream";
import {LatencyTracker} from "./latency";
import {ProtoLatencyTracker, ProtoTimestampEntry} from "./proto/latency_tracker_pb";
import {timestampFromDate} from "@bufbuild/protobuf/wkt";
import {ProtoMessageBase, ProtoMessageInput, ProtoMessageInputSchema} from "./proto/messages_pb";
import {
  ProtoInput,
  ProtoInputSchema,
  ProtoKeyDownSchema,
  ProtoKeyUpSchema,
} from "./proto/types_pb";
import {create, toBinary} from "@bufbuild/protobuf";

interface Props {
  webrtc: WebRTCStream;
}

export class Keyboard {
  protected wrtc: WebRTCStream;
  protected connected!: boolean;

  // Store references to event listeners
  private readonly keydownListener: (e: KeyboardEvent) => void;
  private readonly keyupListener: (e: KeyboardEvent) => void;

  constructor({webrtc}: Props) {
    this.wrtc = webrtc;
    this.keydownListener = this.createKeyboardListener((e: any) => create(ProtoInputSchema, {
      $typeName: "proto.ProtoInput",
      inputType: {
        case: "keyDown",
        value: create(ProtoKeyDownSchema, {
          type: "KeyDown",
          key: this.keyToVirtualKeyCode(e.code)
        }),
      }
    }));
    this.keyupListener = this.createKeyboardListener((e: any) => create(ProtoInputSchema, {
      $typeName: "proto.ProtoInput",
      inputType: {
        case: "keyUp",
        value: create(ProtoKeyUpSchema, {
          type: "KeyUp",
          key: this.keyToVirtualKeyCode(e.code)
        }),
      }
    }));
    this.run()
  }

  private run() {
    if (this.connected)
      this.stop()

    this.connected = true
    document.addEventListener("keydown", this.keydownListener, {passive: false});
    document.addEventListener("keyup", this.keyupListener, {passive: false});
  }

  private stop() {
    document.removeEventListener("keydown", this.keydownListener);
    document.removeEventListener("keyup", this.keyupListener);
    this.connected = false;
  }

  // Helper function to create and return mouse listeners
  private createKeyboardListener(dataCreator: (e: Event) => ProtoInput): (e: Event) => void {
    return (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      // Prevent repeated key events from being sent (important for games)
      if ((e as any).repeat)
        return;

      const data = dataCreator(e as any);

      // Latency tracking
      const tracker = new LatencyTracker("input-keyboard");
      tracker.addTimestamp("client_send");
      const protoTracker: ProtoLatencyTracker = {
        $typeName: "proto.ProtoLatencyTracker",
        sequenceId: tracker.sequence_id,
        timestamps: [],
      };
      for (const t of tracker.timestamps) {
        protoTracker.timestamps.push({
          $typeName: "proto.ProtoTimestampEntry",
          stage: t.stage,
          time: timestampFromDate(t.time),
        } as ProtoTimestampEntry);
      }

      const message: ProtoMessageInput = {
        $typeName: "proto.ProtoMessageInput",
        messageBase: {
          $typeName: "proto.ProtoMessageBase",
          payloadType: "input",
          latency: protoTracker,
        } as ProtoMessageBase,
        data: data,
      };
      this.wrtc.sendBinary(toBinary(ProtoMessageInputSchema, message));
    };
  }

  public dispose() {
    this.stop();
    this.connected = false;
  }

  private keyToVirtualKeyCode(code: string) {
    // Treat Home key as Escape - TODO: Make user-configurable
    if (code === "Home") return 1;
    return keyCodeToLinuxEventCode[code] || undefined;
  }
}