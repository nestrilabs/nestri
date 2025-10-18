import {WebRTCStream} from "./webrtc-stream";
import {LatencyTracker} from "./latency";
import {ProtoMessageInput, ProtoMessageBase, ProtoMessageInputSchema} from "./proto/messages_pb";
import {
  ProtoInput, ProtoInputSchema,
  ProtoMouseKeyDown, ProtoMouseKeyDownSchema,
  ProtoMouseKeyUp, ProtoMouseKeyUpSchema,
  ProtoMouseMove,
  ProtoMouseMoveSchema,
  ProtoMouseWheel, ProtoMouseWheelSchema
} from "./proto/types_pb";
import {mouseButtonToLinuxEventCode} from "./codes";
import {ProtoLatencyTracker, ProtoTimestampEntry} from "./proto/latency_tracker_pb";
import {create, toBinary} from "@bufbuild/protobuf";
import {timestampFromDate} from "@bufbuild/protobuf/wkt";

interface Props {
  webrtc: WebRTCStream;
  canvas: HTMLCanvasElement;
}

export class Mouse {
  protected wrtc: WebRTCStream;
  protected canvas: HTMLCanvasElement;
  protected connected!: boolean;

  private sendInterval = 10 // 100 updates per second

  // Store references to event listeners
  private readonly mousemoveListener: (e: MouseEvent) => void;
  private movementX: number = 0;
  private movementY: number = 0;

  private readonly mousedownListener: (e: MouseEvent) => void;
  private readonly mouseupListener: (e: MouseEvent) => void;
  private readonly mousewheelListener: (e: WheelEvent) => void;

  constructor({webrtc, canvas}: Props) {
    this.wrtc = webrtc;
    this.canvas = canvas;

    this.sendInterval = 1000 / webrtc.currentFrameRate;

    this.mousemoveListener = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      this.movementX += e.movementX;
      this.movementY += e.movementY;
    };

    this.mousedownListener = this.createMouseListener((e: any) => create(ProtoInputSchema, {
      $typeName: "proto.ProtoInput",
      inputType: {
        case: "mouseKeyDown",
        value: create(ProtoMouseKeyDownSchema, {
          type: "MouseKeyDown",
          key: this.keyToVirtualKeyCode(e.button)
        }),
      }
    }));
    this.mouseupListener = this.createMouseListener((e: any) => create(ProtoInputSchema, {
      $typeName: "proto.ProtoInput",
      inputType: {
        case: "mouseKeyUp",
        value: create(ProtoMouseKeyUpSchema, {
          type: "MouseKeyUp",
          key: this.keyToVirtualKeyCode(e.button)
        }),
      }
    }));
    this.mousewheelListener = this.createMouseListener((e: any) => create(ProtoInputSchema, {
      $typeName: "proto.ProtoInput",
      inputType: {
        case: "mouseWheel",
        value: create(ProtoMouseWheelSchema, {
          type: "MouseWheel",
          x: Math.round(e.deltaX),
          y: Math.round(e.deltaY),
        }),
      }
    }));

    this.run()
    this.startProcessing();
  }

  private run() {
    //calls all the other functions
    if (!document.pointerLockElement) {
      console.log("no pointerlock")
      if (this.connected) {
        this.stop()
      }
      return;
    }

    if (document.pointerLockElement == this.canvas) {
      this.connected = true
      this.canvas.addEventListener("mousemove", this.mousemoveListener, {passive: false});
      this.canvas.addEventListener("mousedown", this.mousedownListener, {passive: false});
      this.canvas.addEventListener("mouseup", this.mouseupListener, {passive: false});
      this.canvas.addEventListener("wheel", this.mousewheelListener, {passive: false});

    } else {
      if (this.connected) {
        this.stop()
      }
    }

  }

  private stop() {
    this.canvas.removeEventListener("mousemove", this.mousemoveListener);
    this.canvas.removeEventListener("mousedown", this.mousedownListener);
    this.canvas.removeEventListener("mouseup", this.mouseupListener);
    this.canvas.removeEventListener("wheel", this.mousewheelListener);
    this.connected = false;
  }

  private startProcessing() {
    setInterval(() => {
      if (this.connected && (this.movementX !== 0 || this.movementY !== 0)) {
        this.sendAggregatedMouseMove();
        this.movementX = 0;
        this.movementY = 0;
      }
    }, this.sendInterval);
  }

  private sendAggregatedMouseMove() {
    const data = create(ProtoInputSchema, {
      $typeName: "proto.ProtoInput",
      inputType: {
        case: "mouseMove",
        value: create(ProtoMouseMoveSchema, {
          type: "MouseMove",
          x: Math.round(this.movementX),
          y: Math.round(this.movementY),
        }),
      },
    });

    // Latency tracking
    const tracker = new LatencyTracker("input-mouse");
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
  }

  // Helper function to create and return mouse listeners
  private createMouseListener(dataCreator: (e: Event) => ProtoInput): (e: Event) => void {
    return (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      const data = dataCreator(e as any);

      // Latency tracking
      const tracker = new LatencyTracker("input-mouse");
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
    document.exitPointerLock();
    this.stop();
    this.connected = false;
  }

  private keyToVirtualKeyCode(code: number) {
    return mouseButtonToLinuxEventCode[code] || undefined;
  }
}