import { keyCodeToLinuxEventCode } from "./codes";
import { WebRTCStream } from "./webrtc-stream";
import { ProtoKeyDownSchema, ProtoKeyUpSchema } from "./proto/types_pb";
import { create, toBinary } from "@bufbuild/protobuf";
import { createMessage } from "./utils";
import { ProtoMessageSchema } from "./proto/messages_pb";

interface Props {
  webrtc: WebRTCStream;
}

export class Keyboard {
  protected wrtc: WebRTCStream;
  protected connected!: boolean;

  // Store references to event listeners
  private readonly keydownListener: (e: KeyboardEvent) => void;
  private readonly keyupListener: (e: KeyboardEvent) => void;

  constructor({ webrtc }: Props) {
    this.wrtc = webrtc;
    this.keydownListener = this.createKeyboardListener((e: any) =>
      create(ProtoKeyDownSchema, {
        key: this.keyToVirtualKeyCode(e.code),
      }),
    );
    this.keyupListener = this.createKeyboardListener((e: any) =>
      create(ProtoKeyUpSchema, {
        key: this.keyToVirtualKeyCode(e.code),
      }),
    );
    this.run();
  }

  private run() {
    if (this.connected) this.stop();

    this.connected = true;
    document.addEventListener("keydown", this.keydownListener, {
      passive: false,
    });
    document.addEventListener("keyup", this.keyupListener, { passive: false });
  }

  private stop() {
    document.removeEventListener("keydown", this.keydownListener);
    document.removeEventListener("keyup", this.keyupListener);
    this.connected = false;
  }

  // Helper function to create and return mouse listeners
  private createKeyboardListener(
    dataCreator: (e: Event) => any,
  ): (e: Event) => void {
    return (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      // Prevent repeated key events from being sent (important for games)
      if ((e as any).repeat) return;

      const data = dataCreator(e as any);

      const message = createMessage(data, "input");
      this.wrtc.sendBinary(toBinary(ProtoMessageSchema, message));
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
