import { controllerButtonToLinuxEventCode } from "./codes";
import { WebRTCStream } from "./webrtc-stream";
import {
  ProtoControllerAttachSchema,
  ProtoControllerDetachSchema,
  ProtoControllerStateBatchSchema,
  ProtoControllerStateBatch,
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
  previousButtonState: Map<number, boolean>;
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

enum PollState {
  IDLE,
  RUNNING,
}

export class Controller {
  protected wrtc: WebRTCStream;
  protected connected: boolean = false;
  protected gamepad: Gamepad | null = null;
  protected state: GamepadState = {
    previousButtonState: new Map<number, boolean>(),
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

  // Polling configuration
  private readonly FULL_RATE_MS = 10; // 100 UPS
  private readonly IDLE_THRESHOLD = 100; // ms before considering idle/hands off controller
  private readonly FULL_INTERVAL = 250; // ms before sending full state occassionally, to verify inputs are synced

  // Polling state
  private pollingState: PollState = PollState.IDLE;
  private lastInputTime: number = Date.now();
  private lastFullTime: number = Date.now();
  private pollInterval: any = null;

  // Controller batch vars
  private sequence: number = 0;
  private readonly CHANGED_BUTTONS_STATE = 1 << 0;
  private readonly CHANGED_LEFT_STICK_X = 1 << 1;
  private readonly CHANGED_LEFT_STICK_Y = 1 << 2;
  private readonly CHANGED_RIGHT_STICK_X = 1 << 3;
  private readonly CHANGED_RIGHT_STICK_Y = 1 << 4;
  private readonly CHANGED_LEFT_TRIGGER = 1 << 5;
  private readonly CHANGED_RIGHT_TRIGGER = 1 << 6;
  private readonly CHANGED_DPAD_X = 1 << 7;
  private readonly CHANGED_DPAD_Y = 1 << 8;

  private _dcHandler: ((data: ArrayBuffer) => void) | null = null;

  constructor({ webrtc, e }: Props) {
    this.wrtc = webrtc;

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
          this.run();
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

  private restartPolling() {
    // Clear existing interval
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    // Restart with active polling
    this.pollingState = PollState.RUNNING;
    this.lastInputTime = Date.now();

    // Start interval
    this.pollInterval = setInterval(
      () => this.pollGamepad(),
      this.FULL_RATE_MS,
    );
  }

  private pollGamepad() {
    if (!this.connected || !this.gamepad) return;

    const gamepads = navigator.getGamepads();
    if (!gamepads[this.gamepad.index]) return;

    this.gamepad = gamepads[this.gamepad.index];

    // Collect state changes
    const changedFields = this.collectStateChanges();

    // Send batched changes update if there's changes
    if (changedFields > 0) {
      let send_type = 1;
      const timeSinceFull = Date.now() - this.lastFullTime;
      if (timeSinceFull > this.FULL_INTERVAL) {
        send_type = 0;
        this.lastFullTime = Date.now();
      }

      this.sendBatchedState(changedFields, send_type);
      this.lastInputTime = Date.now();
      if (this.pollingState !== PollState.RUNNING) {
        this.pollingState = PollState.RUNNING;
      }
    }

    const timeSinceInput = Date.now() - this.lastInputTime;
    if (timeSinceInput > this.IDLE_THRESHOLD) {
      // Changing from running to idle..
      if (this.pollingState === PollState.RUNNING) {
        // Send full state on idle assumption
        this.sendBatchedState(0xff, 0);
        this.pollingState = PollState.IDLE;
      }
    }

    this.state.buttonState.forEach((b, i) =>
      this.state.previousButtonState.set(i, b),
    );
  }

  private collectStateChanges(): number {
    let changedFields = 0;

    // Collect analog values
    const leftTrigger = Math.round(
      this.remapFromTo(
        this.gamepad.buttons[6]?.value ?? 0,
        0,
        1,
        -32768,
        32767,
      ),
    );
    const rightTrigger = Math.round(
      this.remapFromTo(
        this.gamepad.buttons[7]?.value ?? 0,
        0,
        1,
        -32768,
        32767,
      ),
    );

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
    const sendLeftX =
      Math.abs(leftX) > this.stickDeadzone ? Math.round(leftX) : 0;
    const sendLeftY =
      Math.abs(leftY) > this.stickDeadzone ? Math.round(leftY) : 0;

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
    const sendRightX =
      Math.abs(rightX) > this.stickDeadzone ? Math.round(rightX) : 0;
    const sendRightY =
      Math.abs(rightY) > this.stickDeadzone ? Math.round(rightY) : 0;

    const dpadX =
      (this.gamepad.buttons[14]?.pressed ? -1 : 0) +
      (this.gamepad.buttons[15]?.pressed ? 1 : 0);
    const dpadY =
      (this.gamepad.buttons[12]?.pressed ? -1 : 0) +
      (this.gamepad.buttons[13]?.pressed ? 1 : 0);

    // Check what changed
    for (let i = 0; i < this.gamepad.buttons.length; i++) {
      if (i >= 6 && i <= 7) continue; // Skip triggers
      if (i >= 12 && i <= 15) continue; // Skip d-pad
      if (this.state.buttonState.get(i) !== this.gamepad.buttons[i].pressed) {
        changedFields |= this.CHANGED_BUTTONS_STATE;
      }
      this.state.buttonState.set(i, this.gamepad.buttons[i].pressed);
    }
    if (leftTrigger !== this.state.leftTrigger) {
      changedFields |= this.CHANGED_LEFT_TRIGGER;
    }
    this.state.leftTrigger = leftTrigger;
    if (rightTrigger !== this.state.rightTrigger) {
      changedFields |= this.CHANGED_RIGHT_TRIGGER;
    }
    this.state.rightTrigger = rightTrigger;
    if (sendLeftX !== this.state.leftX) {
      changedFields |= this.CHANGED_LEFT_STICK_X;
    }
    this.state.leftX = sendLeftX;
    if (sendLeftY !== this.state.leftY) {
      changedFields |= this.CHANGED_LEFT_STICK_Y;
    }
    this.state.leftY = sendLeftY;
    if (sendRightX !== this.state.rightX) {
      changedFields |= this.CHANGED_RIGHT_STICK_X;
    }
    this.state.rightX = sendRightX;
    if (sendRightY !== this.state.rightY) {
      changedFields |= this.CHANGED_RIGHT_STICK_Y;
    }
    this.state.rightY = sendRightY;
    if (dpadX !== this.state.dpadX) {
      changedFields |= this.CHANGED_DPAD_X;
    }
    this.state.dpadX = dpadX;
    if (dpadY !== this.state.dpadY) {
      changedFields |= this.CHANGED_DPAD_Y;
    }
    this.state.dpadY = dpadY;

    return changedFields;
  }

  private sendBatchedState(changedFields: number, updateType: number) {
    // @ts-ignore
    let message: ProtoControllerStateBatch = {
      sessionSlot: this.gamepad.index,
      sessionId: this.wrtc.getSessionID(),
      updateType: updateType,
      sequence: this.sequence++,
    };

    // For FULL_STATE, include everything
    if (updateType === 0) {
      message.changedFields = 0xff;

      message.buttonChangedMask = Object.fromEntries(
        Array.from(this.state.buttonState)
          .map(
            ([key, value]) =>
              [this.controllerButtonToVirtualKeyCode(key), value] as const,
          )
          .filter(([code]) => code !== undefined),
      );
      message.leftStickX = this.state.leftX;
      message.leftStickY = this.state.leftY;
      message.rightStickX = this.state.rightX;
      message.rightStickY = this.state.rightY;
      message.leftTrigger = this.state.leftTrigger;
      message.rightTrigger = this.state.rightTrigger;
      message.dpadX = this.state.dpadX;
      message.dpadY = this.state.dpadY;
    }
    // For DELTA, only include changed fields
    else {
      message.changedFields = changedFields;

      if (changedFields & this.CHANGED_BUTTONS_STATE) {
        const currentStateMap = this.state.buttonState;
        const previousStateMap = this.state.previousButtonState;
        const allKeys = new Set([
          // @ts-ignore
          ...currentStateMap.keys(),
          // @ts-ignore
          ...previousStateMap.keys(),
        ]);
        message.buttonChangedMask = Object.fromEntries(
          Array.from(allKeys)
            .filter((key) => {
              const newState = currentStateMap.get(key);
              const oldState = previousStateMap.get(key);
              return newState !== oldState;
            })
            .map((key) => {
              const newValue = currentStateMap.get(key) ?? false;
              return [
                this.controllerButtonToVirtualKeyCode(key),
                newValue,
              ] as const;
            })
            .filter(([code]) => code !== undefined),
        );
      }
      if (changedFields & this.CHANGED_LEFT_STICK_X) {
        message.leftStickX = this.state.leftX;
      }
      if (changedFields & this.CHANGED_LEFT_STICK_Y) {
        message.leftStickY = this.state.leftY;
      }
      if (changedFields & this.CHANGED_RIGHT_STICK_X) {
        message.rightStickX = this.state.rightX;
      }
      if (changedFields & this.CHANGED_RIGHT_STICK_Y) {
        message.rightStickY = this.state.rightY;
      }
      if (changedFields & this.CHANGED_LEFT_TRIGGER) {
        message.leftTrigger = this.state.leftTrigger;
      }
      if (changedFields & this.CHANGED_RIGHT_TRIGGER) {
        message.rightTrigger = this.state.rightTrigger;
      }
      if (changedFields & this.CHANGED_DPAD_X) {
        message.dpadX = this.state.dpadX;
      }
      if (changedFields & this.CHANGED_DPAD_Y) {
        message.dpadY = this.state.dpadY;
      }
    }

    // Send message
    const batchMessage = createMessage(
      create(
        ProtoControllerStateBatchSchema,
        message as ProtoControllerStateBatch,
      ),
      "controllerInput",
    );
    this.wrtc.sendBinary(toBinary(ProtoMessageSchema, batchMessage));
  }

  public run() {
    if (this.connected) this.stop();

    this.connected = true;

    // Start with active polling
    this.restartPolling();
  }

  public stop() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
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
    if (this.gamepad) {
      // Gamepad disconnected
      const detachMsg = createMessage(
        create(ProtoControllerDetachSchema, {
          sessionSlot: this.gamepad.index,
        }),
        "controllerInput",
      );
      this.wrtc.sendBinary(toBinary(ProtoMessageSchema, detachMsg));
    }
  }

  private controllerButtonToVirtualKeyCode(code: number): number | undefined {
    return controllerButtonToLinuxEventCode[code] || undefined;
  }

  private rumbleCallback(rumbleMsg: ProtoControllerRumble) {
    if (!this.connected || !this.gamepad) return;

    // Check if this rumble is for us
    if (
      rumbleMsg.sessionId !== this.wrtc.getSessionID() ||
      rumbleMsg.sessionSlot !== this.gamepad.index
    )
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
