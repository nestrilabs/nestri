import { controllerButtonToLinuxEventCode } from "./codes";
import { WebRTCStream } from "./webrtc-stream";
import {
  ProtoMessageBase,
  ProtoMessageInput,
  ProtoMessageInputSchema,
} from "./proto/messages_pb";
import {
  ProtoInputSchema,
  ProtoControllerAttachSchema,
  ProtoControllerDetachSchema,
  ProtoControllerButtonSchema,
  ProtoControllerTriggerSchema,
  ProtoControllerAxisSchema,
  ProtoControllerStickSchema,
  ProtoControllerRumble,
} from "./proto/types_pb";
import { create, toBinary, fromBinary } from "@bufbuild/protobuf";

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
  protected slot: number;
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
  private _dcRumbleHandler: ((data: ArrayBuffer) => void) | null = null;

  constructor({ webrtc, e }: Props) {
    this.wrtc = webrtc;
    this.slot = e.gamepad.index;

    this.updateInterval = 1000 / webrtc.currentFrameRate;

    // Gamepad connected
    this.gamepad = e.gamepad;

    // Get vendor of gamepad from id string (i.e. "... Vendor: 054c Product: 09cc")
    const vendorMatch = e.gamepad.id.match(/Vendor:\s?([0-9a-fA-F]{4})/);
    const vendorId = vendorMatch ? vendorMatch[1].toLowerCase() : "unknown";
    // Get product id of gamepad from id string
    const productMatch = e.gamepad.id.match(/Product:\s?([0-9a-fA-F]{4})/);
    const productId = productMatch ? productMatch[1].toLowerCase() : "unknown";

    const attachMsg = create(ProtoInputSchema, {
      $typeName: "proto.ProtoInput",
      inputType: {
        case: "controllerAttach",
        value: create(ProtoControllerAttachSchema, {
          type: "ControllerAttach",
          id: this.vendor_id_to_controller(vendorId, productId),
          slot: this.slot,
        }),
      },
    });
    const message: ProtoMessageInput = {
      $typeName: "proto.ProtoMessageInput",
      messageBase: {
        $typeName: "proto.ProtoMessageBase",
        payloadType: "controllerInput",
      } as ProtoMessageBase,
      data: attachMsg,
    };
    this.wrtc.sendBinary(toBinary(ProtoMessageInputSchema, message));

    // Listen to feedback rumble events from server
    this._dcRumbleHandler = (data: any) => this.rumbleCallback(data as ArrayBuffer);
    this.wrtc.addDataChannelCallback(this._dcRumbleHandler);

    this.run();
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
    const gamepads = navigator.getGamepads();
    if (this.slot < gamepads.length) {
      const gamepad = gamepads[this.slot];
      if (gamepad) {
        /* Button handling */
        gamepad.buttons.forEach((button, index) => {
          // Ignore d-pad buttons (12-15) as we handle those as axis
          if (index >= 12 && index <= 15) return;
          // ignore trigger buttons (6-7) as we handle those as axis
          if (index === 6 || index === 7) return;
          // If state differs, send
          if (button.pressed !== this.lastState.buttonState.get(index)) {
            const linuxCode = this.controllerButtonToVirtualKeyCode(index);
            if (linuxCode === undefined) {
              // Skip unmapped button index
              this.lastState.buttonState.set(index, button.pressed);
              return;
            }

            const buttonProto = create(ProtoInputSchema, {
              $typeName: "proto.ProtoInput",
              inputType: {
                case: "controllerButton",
                value: create(ProtoControllerButtonSchema, {
                  type: "ControllerButton",
                  slot: this.slot,
                  button: linuxCode,
                  pressed: button.pressed,
                }),
              },
            });
            const buttonMessage: ProtoMessageInput = {
              $typeName: "proto.ProtoMessageInput",
              messageBase: {
                $typeName: "proto.ProtoMessageBase",
                payloadType: "controllerInput",
              } as ProtoMessageBase,
              data: buttonProto,
            };
            this.wrtc.sendBinary(
              toBinary(ProtoMessageInputSchema, buttonMessage),
            );
            // Store button state
            this.lastState.buttonState.set(index, button.pressed);
          }
        });

        /* Trigger handling */
        // map trigger value from 0.0 to 1.0 to -32768 to 32767
        const leftTrigger = Math.round(
          this.remapFromTo(gamepad.buttons[6]?.value ?? 0, 0, 1, -32768, 32767),
        );
        // If state differs, send
        if (leftTrigger !== this.lastState.leftTrigger) {
          const triggerProto = create(ProtoInputSchema, {
            $typeName: "proto.ProtoInput",
            inputType: {
              case: "controllerTrigger",
              value: create(ProtoControllerTriggerSchema, {
                type: "ControllerTrigger",
                slot: this.slot,
                trigger: 0, // 0 = left, 1 = right
                value: leftTrigger,
              }),
            },
          });
          const triggerMessage: ProtoMessageInput = {
            $typeName: "proto.ProtoMessageInput",
            messageBase: {
              $typeName: "proto.ProtoMessageBase",
              payloadType: "controllerInput",
            } as ProtoMessageBase,
            data: triggerProto,
          };
          this.lastState.leftTrigger = leftTrigger;
          this.wrtc.sendBinary(
            toBinary(ProtoMessageInputSchema, triggerMessage),
          );
        }
        const rightTrigger = Math.round(
          this.remapFromTo(gamepad.buttons[7]?.value ?? 0, 0, 1, -32768, 32767),
        );
        // If state differs, send
        if (rightTrigger !== this.lastState.rightTrigger) {
          const triggerProto = create(ProtoInputSchema, {
            $typeName: "proto.ProtoInput",
            inputType: {
              case: "controllerTrigger",
              value: create(ProtoControllerTriggerSchema, {
                type: "ControllerTrigger",
                slot: this.slot,
                trigger: 1, // 0 = left, 1 = right
                value: rightTrigger,
              }),
            },
          });
          const triggerMessage: ProtoMessageInput = {
            $typeName: "proto.ProtoMessageInput",
            messageBase: {
              $typeName: "proto.ProtoMessageBase",
              payloadType: "controllerInput",
            } as ProtoMessageBase,
            data: triggerProto,
          };
          this.lastState.rightTrigger = rightTrigger;
          this.wrtc.sendBinary(
            toBinary(ProtoMessageInputSchema, triggerMessage),
          );
        }

        /* DPad handling */
        // We send dpad buttons as axis values -1 to 1 for left/up, right/down
        const dpadLeft = gamepad.buttons[14]?.pressed ? 1 : 0;
        const dpadRight = gamepad.buttons[15]?.pressed ? 1 : 0;
        const dpadX = dpadLeft ? -1 : dpadRight ? 1 : 0;
        if (dpadX !== this.lastState.dpadX) {
          const dpadProto = create(ProtoInputSchema, {
            $typeName: "proto.ProtoInput",
            inputType: {
              case: "controllerAxis",
              value: create(ProtoControllerAxisSchema, {
                type: "ControllerAxis",
                slot: this.slot,
                axis: 0, // 0 = dpadX, 1 = dpadY
                value: dpadX,
              }),
            },
          });
          const dpadMessage: ProtoMessageInput = {
            $typeName: "proto.ProtoMessageInput",
            messageBase: {
              $typeName: "proto.ProtoMessageBase",
              payloadType: "controllerInput",
            } as ProtoMessageBase,
            data: dpadProto,
          };
          this.lastState.dpadX = dpadX;
          this.wrtc.sendBinary(toBinary(ProtoMessageInputSchema, dpadMessage));
        }

        const dpadUp = gamepad.buttons[12]?.pressed ? 1 : 0;
        const dpadDown = gamepad.buttons[13]?.pressed ? 1 : 0;
        const dpadY = dpadUp ? -1 : dpadDown ? 1 : 0;
        if (dpadY !== this.lastState.dpadY) {
          const dpadProto = create(ProtoInputSchema, {
            $typeName: "proto.ProtoInput",
            inputType: {
              case: "controllerAxis",
              value: create(ProtoControllerAxisSchema, {
                type: "ControllerAxis",
                slot: this.slot,
                axis: 1, // 0 = dpadX, 1 = dpadY
                value: dpadY,
              }),
            },
          });
          const dpadMessage: ProtoMessageInput = {
            $typeName: "proto.ProtoMessageInput",
            messageBase: {
              $typeName: "proto.ProtoMessageBase",
              payloadType: "controllerInput",
            } as ProtoMessageBase,
            data: dpadProto,
          };
          this.lastState.dpadY = dpadY;
          this.wrtc.sendBinary(toBinary(ProtoMessageInputSchema, dpadMessage));
        }

        /* Stick handling */
        // stick values need to be mapped from -1.0 to 1.0 to -32768 to 32767
        const leftX = this.remapFromTo(gamepad.axes[0] ?? 0, -1, 1, -32768, 32767);
        const leftY = this.remapFromTo(gamepad.axes[1] ?? 0, -1, 1, -32768, 32767);
        // Apply deadzone
        const sendLeftX =
          Math.abs(leftX) > this.stickDeadzone ? Math.round(leftX) : 0;
        const sendLeftY =
          Math.abs(leftY) > this.stickDeadzone ? Math.round(leftY) : 0;
        // if outside deadzone, send normally if changed
        // if moves inside deadzone, zero it if not inside deadzone last time
        if (
          sendLeftX !== this.lastState.leftX ||
          sendLeftY !== this.lastState.leftY
        ) {
          // console.log("Sticks: ", sendLeftX, sendLeftY, sendRightX, sendRightY);
          const stickProto = create(ProtoInputSchema, {
            $typeName: "proto.ProtoInput",
            inputType: {
              case: "controllerStick",
              value: create(ProtoControllerStickSchema, {
                type: "ControllerStick",
                slot: this.slot,
                stick: 0, // 0 = left, 1 = right
                x: sendLeftX,
                y: sendLeftY,
              }),
            },
          });
          const stickMessage: ProtoMessageInput = {
            $typeName: "proto.ProtoMessageInput",
            messageBase: {
              $typeName: "proto.ProtoMessageBase",
              payloadType: "controllerInput",
            } as ProtoMessageBase,
            data: stickProto,
          };
          this.lastState.leftX = sendLeftX;
          this.lastState.leftY = sendLeftY;
          this.wrtc.sendBinary(toBinary(ProtoMessageInputSchema, stickMessage));
        }

        const rightX = this.remapFromTo(gamepad.axes[2] ?? 0, -1, 1, -32768, 32767);
        const rightY = this.remapFromTo(gamepad.axes[3] ?? 0, -1, 1, -32768, 32767);
        // Apply deadzone
        const sendRightX =
          Math.abs(rightX) > this.stickDeadzone ? Math.round(rightX) : 0;
        const sendRightY =
          Math.abs(rightY) > this.stickDeadzone ? Math.round(rightY) : 0;
        if (
          sendRightX !== this.lastState.rightX ||
          sendRightY !== this.lastState.rightY
        ) {
          const stickProto = create(ProtoInputSchema, {
            $typeName: "proto.ProtoInput",
            inputType: {
              case: "controllerStick",
              value: create(ProtoControllerStickSchema, {
                type: "ControllerStick",
                slot: this.slot,
                stick: 1, // 0 = left, 1 = right
                x: sendRightX,
                y: sendRightY,
              }),
            },
          });
          const stickMessage: ProtoMessageInput = {
            $typeName: "proto.ProtoMessageInput",
            messageBase: {
              $typeName: "proto.ProtoMessageBase",
              payloadType: "controllerInput",
            } as ProtoMessageBase,
            data: stickProto,
          };
          this.lastState.rightX = sendRightX;
          this.lastState.rightY = sendRightY;
          this.wrtc.sendBinary(toBinary(ProtoMessageInputSchema, stickMessage));
        }
      }
    }
  }

  private loopInterval: any = null;

  public run() {
    if (this.connected)
      this.stop();

    this.connected = true;
    // Poll gamepads in setInterval loop
    this.loopInterval = setInterval(() => {
      if (this.connected) this.pollGamepad();
    }, this.updateInterval);
  }

  public stop() {
    if (this.loopInterval) {
      clearInterval(this.loopInterval);
      this.loopInterval = null;
    }
    this.connected = false;
  }

  public getSlot() {
    return this.slot;
  }

  public dispose() {
    this.stop();
    // Remove callback
    if (this._dcRumbleHandler !== null) {
      this.wrtc.removeDataChannelCallback(this._dcRumbleHandler);
      this._dcRumbleHandler = null;
    }
    // Gamepad disconnected
    const detachMsg = create(ProtoInputSchema, {
      $typeName: "proto.ProtoInput",
      inputType: {
        case: "controllerDetach",
        value: create(ProtoControllerDetachSchema, {
          type: "ControllerDetach",
          slot: this.slot,
        }),
      },
    });
    const message: ProtoMessageInput = {
      $typeName: "proto.ProtoMessageInput",
      messageBase: {
        $typeName: "proto.ProtoMessageBase",
        payloadType: "controllerInput",
      } as ProtoMessageBase,
      data: detachMsg,
    };
    this.wrtc.sendBinary(toBinary(ProtoMessageInputSchema, message));
  }

  private controllerButtonToVirtualKeyCode(code: number) {
    return controllerButtonToLinuxEventCode[code] || undefined;
  }

  private rumbleCallback(data: ArrayBuffer) {
    // If not connected, ignore
    if (!this.connected) return;
    try {
      // First decode the wrapper message
      const uint8Data = new Uint8Array(data);
      const messageWrapper = fromBinary(ProtoMessageInputSchema, uint8Data);

      // Check if it contains controller rumble data
      if (messageWrapper.data?.inputType?.case === "controllerRumble") {
        const rumbleMsg = messageWrapper.data.inputType.value as ProtoControllerRumble;

        // Check if aimed at this controller slot
        if (rumbleMsg.slot !== this.slot) return;

        // Trigger actual rumble
        // Need to remap from 0-65535 to 0.0-1.0 ranges
        const clampedLowFreq = Math.max(0, Math.min(65535, rumbleMsg.lowFrequency));
        const rumbleLowFreq = this.remapFromTo(
          clampedLowFreq,
          0,
          65535,
          0.0,
          1.0,
        );
        const clampedHighFreq = Math.max(0, Math.min(65535, rumbleMsg.highFrequency));
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
          this.gamepad.vibrationActuator.playEffect("dual-rumble", {
            startDelay: 0,
            duration: rumbleDuration,
            weakMagnitude: rumbleLowFreq,
            strongMagnitude: rumbleHighFreq,
          }).catch(console.error);
        }
      }
    } catch (error) {
      console.error("Failed to decode rumble message:", error);
    }
  }
}
