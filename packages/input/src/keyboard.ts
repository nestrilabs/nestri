import {type Input} from "./types"
import {keyCodeToLinuxEventCode} from "./codes"
import {MessageInput, encodeMessage} from "./messages";
import {WebRTCStream} from "./webrtc-stream";
import {LatencyTracker} from "./latency";

interface Props {
  webrtc: WebRTCStream;
  canvas: HTMLCanvasElement;
}

export class Keyboard {
  protected wrtc: WebRTCStream;
  protected canvas: HTMLCanvasElement;
  protected connected!: boolean;

  // Store references to event listeners
  private keydownListener: (e: KeyboardEvent) => void;
  private keyupListener: (e: KeyboardEvent) => void;

  constructor({webrtc, canvas}: Props) {
    this.wrtc = webrtc;
    this.canvas = canvas;
    this.keydownListener = this.createKeyboardListener("keydown", (e: any) => ({
      type: "KeyDown",
      key: this.keyToVirtualKeyCode(e.code)
    }));
    this.keyupListener = this.createKeyboardListener("keyup", (e: any) => ({
      type: "KeyUp",
      key: this.keyToVirtualKeyCode(e.code)
    }));
    this.run()
  }

  private run() {
    //calls all the other functions
    if (!document.pointerLockElement) {
      if (this.connected) {
        this.stop()
      }
      return;
    }

    if (document.pointerLockElement == this.canvas) {
      this.connected = true
      document.addEventListener("keydown", this.keydownListener, {passive: false});
      document.addEventListener("keyup", this.keyupListener, {passive: false});
    } else {
      if (this.connected) {
        this.stop()
      }
    }
  }

  private stop() {
    document.removeEventListener("keydown", this.keydownListener);
    document.removeEventListener("keyup", this.keyupListener);
    this.connected = false;
  }

  // Helper function to create and return mouse listeners
  private createKeyboardListener(type: string, dataCreator: (e: Event) => Partial<Input>): (e: Event) => void {
    return (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      // Prevent repeated key events from being sent (important for games)
      if ((e as any).repeat)
        return;

      const data = dataCreator(e as any); // type assertion because of the way dataCreator is used
      const dataString = JSON.stringify({...data, type} as Input);

      // Latency tracking
      const tracker = new LatencyTracker("input-keyboard");
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

  private keyToVirtualKeyCode(code: string) {
    // Treat Home key as Escape - TODO: Make user-configurable
    if (code === "Home") return 1;
    return keyCodeToLinuxEventCode[code] || undefined;
  }
}