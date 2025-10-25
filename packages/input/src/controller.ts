import { controllerButtonToLinuxEventCode } from "./codes";
import { WebRTCStream } from "./webrtc-stream";
import {
  ProtoControllerAttachSchema,
  ProtoControllerDetachSchema,
  ProtoControllerButtonSchema,
  ProtoControllerTriggerSchema,
  ProtoControllerAxisSchema,
  ProtoControllerStickSchema,
  ProtoControllerRumble,
} from "./proto/types_pb";
import { create, toBinary, fromBinary } from "@bufbuild/protobuf";
import { createMessage } from "./utils";
import { ProtoMessageSchema } from "./proto/messages_pb";

interface Props {
  webrtc: WebRTCStream;
  e: GamepadEvent;
}

interface GamepadState {
  buttonState: Map<number, boolean>;
  leftTrigger: number;
  rightTrigger: number;
  leftX: number;
  leftY: number;
  rightX: number;
  rightY: number;
  dpadX: number;
  dpadY: number;
}

export class Controller {
  protected wrtc: WebRTCStream;
  protected connected: boolean = false;
  protected gamepad: Gamepad | null = null;
  protected lastState: GamepadState = {
    buttonState: new Map<number, boolean>(),
    leftTrigger: 0,
    rightTrigger: 0,
    leftX: 0,
    leftY: 0,
    rightX: 0,
    rightY: 0,
    dpadX: 0,
    dpadY: 0,
  };
  // TODO: As user configurable, set quite low now for decent controllers (not Nintendo ones :P)
  protected stickDeadzone: number = 2048; // 2048 / 32768 = ~0.06 (6% of stick range)

  private updateInterval = 10.0; // 100 updates per second
  private isIdle: boolean = true;
  private lastInputTime: number = Date.now();
  private idleUpdateInterval: number = 150.0; // ~6-7 updates per second for keep-alive packets
  private inputDetected: boolean = false;
  private lastFullStateSend: number = Date.now();
  private fullStateSendInterval: number = 500.0; // send full state every 0.5 seconds (helps packet loss)
  private forceFullStateSend: boolean = false;

  private _dcHandler: ((data: ArrayBuffer) => void) | null = null;

  constructor({ webrtc, e }: Props) {
    this.wrtc = webrtc;

    this.updateInterval = 1000 / webrtc.currentFrameRate;

    // Get vendor of gamepad from id string (i.e. "... Vendor: 054c Product: 09cc")
    const vendorMatch = e.gamepad.id.match(/Vendor:\s?([0-9a-fA-F]{4})/);
    const vendorId = vendorMatch ? vendorMatch[1].toLowerCase() : "unknown";
    // Get product id of gamepad from id string
    const productMatch = e.gamepad.id.match(/Product:\s?([0-9a-fA-F]{4})/);
    const productId = productMatch ? productMatch[1].toLowerCase() : "unknown";

    // Listen to datachannel events from server
    this._dcHandler = (data: ArrayBuffer) => {
      if (!this.connected) return;
      try {
        // First decode the wrapper message
        const uint8Data = new Uint8Array(data);
        const messageWrapper = fromBinary(ProtoMessageSchema, uint8Data);

        if (messageWrapper.payload.case === "controllerRumble") {
          this.rumbleCallback(messageWrapper.payload.value);
        } else if (messageWrapper.payload.case === "controllerAttach") {
          if (this.gamepad) return; // already attached
          const attachMsg = messageWrapper.payload.value;
          // Gamepad connected succesfully
          this.gamepad = e.gamepad;
          console.log(
            `Gamepad connected: ${e.gamepad.id}, local slot ${e.gamepad.index}, msg: ${attachMsg.sessionSlot}`,
          );
        }
      } catch (err) {
        console.error("Error decoding datachannel message:", err);
      }
    };
    this.wrtc.addDataChannelCallback(this._dcHandler);

    const attachMsg = createMessage(
      create(ProtoControllerAttachSchema, {
        id: this.vendor_id_to_controller(vendorId, productId),
        sessionSlot: e.gamepad.index,
        sessionId: this.wrtc.getSessionID(),
      }),
      "controllerInput",
    );
    this.wrtc.sendBinary(toBinary(ProtoMessageSchema, attachMsg));

    this.run();
  }

  public getSlot(): number {
    return this.gamepad.index;
  }

  // Maps vendor id and product id to supported controller type
  // Currently supported: Sony (ps4, ps5), Microsoft (xbox360, xboxone), Nintendo (switchpro)
  // Default fallback to xbox360
  private vendor_id_to_controller(vendorId: string, productId: string): string {
    switch (vendorId) {
      case "054c": // Sony
        switch (productId) {
          case "0ce6":
            return "ps5";
          case "05c4":
          case "09cc":
            return "ps4";
          default:
            return "ps4"; // default to ps4
        }
      case "045e": // Microsoft
        switch (productId) {
          case "02d1":
          case "02dd":
            return "xboxone";
          case "028e":
            return "xbox360";
          default:
            return "xbox360"; // default to xbox360
        }
      case "057e": // Nintendo
        switch (productId) {
          case "2009":
          case "200e":
            return "switchpro";
          default:
            return "switchpro"; // default to switchpro
        }
      default: {
        return "xbox360";
      }
    }
  }

  private remapFromTo(
    value: number,
    fromMin: number,
    fromMax: number,
    toMin: number,
    toMax: number,
  ) {
    return ((value - fromMin) * (toMax - toMin)) / (fromMax - fromMin) + toMin;
  }

  private pollGamepad() {
    // Get updated gamepad state
    const gamepads = navigator.getGamepads();

    // Periodically force send full state to clear stuck inputs
    if (Date.now() - this.lastFullStateSend > this.fullStateSendInterval) {
      this.forceFullStateSend = true;
      this.lastFullStateSend = Date.now();
    }

    if (this.gamepad) {
      if (gamepads[this.gamepad.index]) {
        this.gamepad = gamepads[this.gamepad!.index];
        /* Button handling */
        this.gamepad.buttons.forEach((button, index) => {
          // Ignore d-pad buttons (12-15) as we handle those as axis
          if (index >= 12 && index <= 15) return;
          // ignore trigger buttons (6-7) as we handle those as axis
          if (index === 6 || index === 7) return;
          // If state differs, send
          if (button.pressed !== this.lastState.buttonState.get(index) || this.forceFullStateSend) {
            const linuxCode = this.controllerButtonToVirtualKeyCode(index);
            if (linuxCode === undefined) {
              // Skip unmapped button index
              this.lastState.buttonState.set(index, button.pressed);
              return;
            }

            const buttonMessage = createMessage(
              create(ProtoControllerButtonSchema, {
                sessionSlot: this.gamepad.index,
                sessionId: this.wrtc.getSessionID(),
                button: linuxCode,
                pressed: button.pressed,
              }),
              "controllerInput",
            );
            this.wrtc.sendBinary(toBinary(ProtoMessageSchema, buttonMessage));
            this.inputDetected = true;
            // Store button state
            this.lastState.buttonState.set(index, button.pressed);
          }
        });

        /* Trigger handling */
        // map trigger value from 0.0 to 1.0 to -32768 to 32767
        const leftTrigger = Math.round(
          this.remapFromTo(
            this.gamepad.buttons[6]?.value ?? 0,
            0,
            1,
            -32768,
            32767,
          ),
        );
        // If state differs, send
        if (leftTrigger !== this.lastState.leftTrigger || this.forceFullStateSend) {
          const triggerMessage = createMessage(
            create(ProtoControllerTriggerSchema, {
              sessionSlot: this.gamepad.index,
              sessionId: this.wrtc.getSessionID(),
              trigger: 0, // 0 = left, 1 = right
              value: leftTrigger,
            }),
            "controllerInput",
          );
          this.wrtc.sendBinary(toBinary(ProtoMessageSchema, triggerMessage));
          this.inputDetected = true;
          this.lastState.leftTrigger = leftTrigger;
        }
        const rightTrigger = Math.round(
          this.remapFromTo(
            this.gamepad.buttons[7]?.value ?? 0,
            0,
            1,
            -32768,
            32767,
          ),
        );
        // If state differs, send
        if (rightTrigger !== this.lastState.rightTrigger || this.forceFullStateSend) {
          const triggerMessage = createMessage(
            create(ProtoControllerTriggerSchema, {
              sessionSlot: this.gamepad.index,
              sessionId: this.wrtc.getSessionID(),
              trigger: 1, // 0 = left, 1 = right
              value: rightTrigger,
            }),
            "controllerInput",
          );
          this.wrtc.sendBinary(toBinary(ProtoMessageSchema, triggerMessage));
          this.inputDetected = true;
          this.lastState.rightTrigger = rightTrigger;
        }

        /* DPad handling */
        // We send dpad buttons as axis values -1 to 1 for left/up, right/down
        const dpadLeft = this.gamepad.buttons[14]?.pressed ? 1 : 0;
        const dpadRight = this.gamepad.buttons[15]?.pressed ? 1 : 0;
        const dpadX = dpadLeft ? -1 : dpadRight ? 1 : 0;
        if (dpadX !== this.lastState.dpadX || this.forceFullStateSend) {
          const dpadMessage = createMessage(
            create(ProtoControllerAxisSchema, {
              sessionSlot: this.gamepad.index,
              sessionId: this.wrtc.getSessionID(),
              axis: 0, // 0 = dpadX, 1 = dpadY
              value: dpadX,
            }),
            "controllerInput",
          );
          this.wrtc.sendBinary(toBinary(ProtoMessageSchema, dpadMessage));
          this.inputDetected = true;
          this.lastState.dpadX = dpadX;
        }

        const dpadUp = this.gamepad.buttons[12]?.pressed ? 1 : 0;
        const dpadDown = this.gamepad.buttons[13]?.pressed ? 1 : 0;
        const dpadY = dpadUp ? -1 : dpadDown ? 1 : 0;
        if (dpadY !== this.lastState.dpadY || this.forceFullStateSend) {
          const dpadMessage = createMessage(
            create(ProtoControllerAxisSchema, {
              sessionSlot: this.gamepad.index,
              sessionId: this.wrtc.getSessionID(),
              axis: 1, // 0 = dpadX, 1 = dpadY
              value: dpadY,
            }),
            "controllerInput",
          );
          this.wrtc.sendBinary(toBinary(ProtoMessageSchema, dpadMessage));
          this.inputDetected = true;
          this.lastState.dpadY = dpadY;
        }

        /* Stick handling */
        // stick values need to be mapped from -1.0 to 1.0 to -32768 to 32767
        const leftX = this.remapFromTo(
          this.gamepad.axes[0] ?? 0,
          -1,
          1,
          -32768,
          32767,
        );
        const leftY = this.remapFromTo(
          this.gamepad.axes[1] ?? 0,
          -1,
          1,
          -32768,
          32767,
        );
        // Apply deadzone
        const sendLeftX =
          Math.abs(leftX) > this.stickDeadzone ? Math.round(leftX) : 0;
        const sendLeftY =
          Math.abs(leftY) > this.stickDeadzone ? Math.round(leftY) : 0;
        // if outside deadzone, send normally if changed
        // if moves inside deadzone, zero it if not inside deadzone last time
        if (
          sendLeftX !== this.lastState.leftX ||
          sendLeftY !== this.lastState.leftY || this.forceFullStateSend
        ) {
          const stickMessage = createMessage(
            create(ProtoControllerStickSchema, {
              sessionSlot: this.gamepad.index,
              sessionId: this.wrtc.getSessionID(),
              stick: 0, // 0 = left, 1 = right
              x: sendLeftX,
              y: sendLeftY,
            }),
            "controllerInput",
          );
          this.wrtc.sendBinary(toBinary(ProtoMessageSchema, stickMessage));
          this.inputDetected = true;
          this.lastState.leftX = sendLeftX;
          this.lastState.leftY = sendLeftY;
        }

        const rightX = this.remapFromTo(
          this.gamepad.axes[2] ?? 0,
          -1,
          1,
          -32768,
          32767,
        );
        const rightY = this.remapFromTo(
          this.gamepad.axes[3] ?? 0,
          -1,
          1,
          -32768,
          32767,
        );
        // Apply deadzone
        const sendRightX =
          Math.abs(rightX) > this.stickDeadzone ? Math.round(rightX) : 0;
        const sendRightY =
          Math.abs(rightY) > this.stickDeadzone ? Math.round(rightY) : 0;
        if (
          sendRightX !== this.lastState.rightX ||
          sendRightY !== this.lastState.rightY || this.forceFullStateSend
        ) {
          const stickMessage = createMessage(
            create(ProtoControllerStickSchema, {
              sessionSlot: this.gamepad.index,
              sessionId: this.wrtc.getSessionID(),
              stick: 1, // 0 = left, 1 = right
              x: sendRightX,
              y: sendRightY,
            }),
            "controllerInput",
          );
          this.wrtc.sendBinary(toBinary(ProtoMessageSchema, stickMessage));
          this.inputDetected = true;
          this.lastState.rightX = sendRightX;
          this.lastState.rightY = sendRightY;
        }
      }
    }

    this.forceFullStateSend = false;
  }

  private loopInterval: any = null;

  public run() {
    if (this.connected) this.stop();

    this.connected = true;
    this.isIdle = true;
    this.lastInputTime = Date.now();

    this.loopInterval = setInterval(() => {
      if (this.connected) {
        this.inputDetected = false; // Reset before poll
        this.pollGamepad();

        // Switch polling rate based on input
        if (this.inputDetected) {
          this.lastInputTime = Date.now();
          if (this.isIdle) {
            this.isIdle = false;
            clearInterval(this.loopInterval);
            this.loopInterval = setInterval(() => {
              if (this.connected) this.pollGamepad();
            }, this.updateInterval);
          }
        } else if (!this.isIdle && Date.now() - this.lastInputTime > 200) {
          // Switch to idle polling after 200ms of no input
          this.isIdle = true;
          clearInterval(this.loopInterval);
          this.loopInterval = setInterval(() => {
            if (this.connected) this.pollGamepad();
          }, this.idleUpdateInterval);
        }
      }
    }, this.isIdle ? this.idleUpdateInterval : this.updateInterval);
  }

  public stop() {
    if (this.loopInterval) {
      clearInterval(this.loopInterval);
      this.loopInterval = null;
    }
    this.connected = false;
  }

  public dispose() {
    this.stop();
    // Remove callback
    if (this._dcHandler !== null) {
      this.wrtc.removeDataChannelCallback(this._dcHandler);
      this._dcHandler = null;
    }
    // Gamepad disconnected
    const detachMsg = createMessage(
      create(ProtoControllerDetachSchema, {
        sessionSlot: this.gamepad.index,
      }),
      "controllerInput",
    );
    this.wrtc.sendBinary(toBinary(ProtoMessageSchema, detachMsg));
  }

  private controllerButtonToVirtualKeyCode(code: number) {
    return controllerButtonToLinuxEventCode[code] || undefined;
  }

  private rumbleCallback(rumbleMsg: ProtoControllerRumble) {
    // If not connected, ignore
    if (!this.connected) return;

    // Check if aimed at this controller slot
    if (rumbleMsg.sessionId !== this.wrtc.getSessionID() &&
        rumbleMsg.sessionSlot !== this.gamepad.index)
      return;

    // Trigger actual rumble
    // Need to remap from 0-65535 to 0.0-1.0 ranges
    const clampedLowFreq = Math.max(0, Math.min(65535, rumbleMsg.lowFrequency));
    const rumbleLowFreq = this.remapFromTo(clampedLowFreq, 0, 65535, 0.0, 1.0);
    const clampedHighFreq = Math.max(
      0,
      Math.min(65535, rumbleMsg.highFrequency),
    );
    const rumbleHighFreq = this.remapFromTo(
      clampedHighFreq,
      0,
      65535,
      0.0,
      1.0,
    );
    // Cap to valid range (max 5000)
    const rumbleDuration = Math.max(0, Math.min(5000, rumbleMsg.duration));
    if (this.gamepad.vibrationActuator) {
      this.gamepad.vibrationActuator
        .playEffect("dual-rumble", {
          startDelay: 0,
          duration: rumbleDuration,
          weakMagnitude: rumbleLowFreq,
          strongMagnitude: rumbleHighFreq,
        })
        .catch(console.error);
    }
  }
}
