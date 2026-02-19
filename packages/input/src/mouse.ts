import { WebRTCStream } from "./webrtc-stream";
import {
  ProtoMouseKeyDownSchema,
  ProtoMouseKeyUpSchema,
  ProtoMouseMoveSchema,
  ProtoMouseWheelSchema,
} from "./proto/types_pb";
import { mouseButtonToLinuxEventCode } from "./codes";
import { create, toBinary } from "@bufbuild/protobuf";
import { createMessage } from "./utils";
import { ProtoMessageSchema } from "./proto/messages_pb";

interface Props {
  webrtc: WebRTCStream;
  canvas: HTMLCanvasElement;
}

export class Mouse {
  protected wrtc: WebRTCStream;
  protected canvas: HTMLCanvasElement;
  protected connected!: boolean;

  private sendInterval = 10; // 100 updates per second

  // Store references to event listeners
  private readonly mousemoveListener: (e: MouseEvent) => void;
  private movementX: number = 0;
  private movementY: number = 0;

  private readonly mousedownListener: (e: MouseEvent) => void;
  private readonly mouseupListener: (e: MouseEvent) => void;
  private readonly mousewheelListener: (e: WheelEvent) => void;

  constructor({ webrtc, canvas }: Props) {
    this.wrtc = webrtc;
    this.canvas = canvas;

    this.mousemoveListener = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      this.movementX += e.movementX;
      this.movementY += e.movementY;
    };

    this.mousedownListener = this.createMouseListener((e: any) =>
      create(ProtoMouseKeyDownSchema, {
        key: this.keyToVirtualKeyCode(e.button),
      }),
    );
    this.mouseupListener = this.createMouseListener((e: any) =>
      create(ProtoMouseKeyUpSchema, {
        key: this.keyToVirtualKeyCode(e.button),
      }),
    );
    this.mousewheelListener = this.createMouseListener((e: any) =>
      create(ProtoMouseWheelSchema, {
        x: Math.round(e.deltaX),
        y: Math.round(e.deltaY),
      }),
    );

    this.run();
    this.startProcessing();
  }

  private run() {
    //calls all the other functions
    if (!document.pointerLockElement) {
      console.log("no pointerlock");
      if (this.connected) {
        this.stop();
      }
      return;
    }

    if (document.pointerLockElement == this.canvas) {
      this.connected = true;
      this.canvas.addEventListener("mousemove", this.mousemoveListener);
      this.canvas.addEventListener("mousedown", this.mousedownListener, {
        passive: true,
      });
      this.canvas.addEventListener("mouseup", this.mouseupListener, {
        passive: true,
      });
      this.canvas.addEventListener("wheel", this.mousewheelListener, {
        passive: true,
      });
    } else {
      if (this.connected) {
        this.stop();
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
      if (this.connected) {
        this.sendAggregatedMouseMove();
        this.movementX = 0;
        this.movementY = 0;
      }
    }, this.sendInterval);
  }

  private sendAggregatedMouseMove() {
    const data = create(ProtoMouseMoveSchema, {
      x: Math.round(this.movementX),
      y: Math.round(this.movementY),
    });

    const message = createMessage(data, "input");
    this.wrtc.sendBinary(toBinary(ProtoMessageSchema, message));
  }

  // Helper function to create and return mouse listeners
  private createMouseListener(
    dataCreator: (e: Event) => any,
  ): (e: Event) => void {
    return (e: Event) => {
      e.stopPropagation();
      const data = dataCreator(e as any);

      const message = createMessage(data, "input");
      this.wrtc.sendBinary(toBinary(ProtoMessageSchema, message));
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
