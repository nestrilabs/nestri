import {type Input} from "./types"
import {mouseButtonToLinuxEventCode} from "./codes"
import {MessageInput, encodeMessage} from "./messages";
import {WebRTCStream} from "./webrtc-stream";
import {LatencyTracker} from "./latency";

interface Props {
  webrtc: WebRTCStream;
  canvas: HTMLCanvasElement;
}

export class Mouse {
  protected wrtc: WebRTCStream;
  protected canvas: HTMLCanvasElement;
  protected connected!: boolean;

  // Store references to event listeners
  private mousemoveListener: (e: MouseEvent) => void;
  private mousedownListener: (e: MouseEvent) => void;
  private mouseupListener: (e: MouseEvent) => void;
  private mousewheelListener: (e: WheelEvent) => void;

  constructor({webrtc, canvas}: Props) {
    this.wrtc = webrtc;
    this.canvas = canvas;

    this.mousemoveListener = this.createMouseListener("mousemove", (e: any) => ({
      type: "MouseMove",
      x: e.movementX,
      y: e.movementY
    }));
    this.mousedownListener = this.createMouseListener("mousedown", (e: any) => ({
      type: "MouseKeyDown",
      key: this.keyToVirtualKeyCode(e.button)
    }));

    this.mouseupListener = this.createMouseListener("mouseup", (e: any) => ({
      type: "MouseKeyUp",
      key: this.keyToVirtualKeyCode(e.button)
    }));
    this.mousewheelListener = this.createMouseListener("wheel", (e: any) => ({
      type: "MouseWheel",
      x: e.deltaX,
      y: e.deltaY
    }));

    this.run()
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
      this.canvas.addEventListener("mousemove", this.mousemoveListener, { passive: false });
      this.canvas.addEventListener("mousedown", this.mousedownListener, { passive: false });
      this.canvas.addEventListener("mouseup", this.mouseupListener, { passive: false });
      this.canvas.addEventListener("wheel", this.mousewheelListener, { passive: false });

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

  // Helper function to create and return mouse listeners
  private createMouseListener(type: string, dataCreator: (e: Event) => Partial<Input>): (e: Event) => void {
    return (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      const data = dataCreator(e as any); // type assertion because of the way dataCreator is used
      const dataString = JSON.stringify({...data, type} as Input);

      // Latency tracking
      const tracker = new LatencyTracker("input-mouse");
      tracker.addTimestamp("client_send");
      const message: MessageInput = {
        payload_type: "input",
        data: dataString,
        latency: tracker,
      };
      this.wrtc.sendBinary(encodeMessage(message));
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