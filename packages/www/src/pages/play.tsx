import { Text } from "@nestri/www/ui/text";
import { createSignal, createEffect, onCleanup, onMount, Show } from "solid-js";
import { useParams } from "@solidjs/router";
import { Keyboard, Mouse, WebRTCStream } from "@nestri/input";
import { Container, FullScreen } from "@nestri/www/ui/layout";

export function PlayComponent() {
    const params = useParams();
    const id = params.id;
    
    const [showBannerModal, setShowBannerModal] = createSignal(false);
    const [showButtonModal, setShowButtonModal] = createSignal(false);
    const [gamepadConnected, setGamepadConnected] = createSignal(false);
    const [buttonPressed, setButtonPressed] = createSignal(null);
    const [leftStickX, setLeftStickX] = createSignal(0);
    const [leftStickY, setLeftStickY] = createSignal(0);
    const [hasStream, setHasStream] = createSignal(false);
    const [nestriLock, setNestriLock] = createSignal(false);
    const [showOffline, setShowOffline] = createSignal(false);
    
    const [canvas, setCanvas] = createSignal<HTMLCanvasElement | undefined>(undefined);
    let video: HTMLVideoElement;
    let webrtc: WebRTCStream;
    let nestriMouse: Mouse , nestriKeyboard: Keyboard;
  
    const initializeInputDevices = () => {
        const canvasElement = canvas();
        if (!canvasElement || !webrtc) return;
        try {
            nestriMouse = new Mouse({ canvas: canvasElement, webrtc });
            nestriKeyboard = new Keyboard({ canvas: canvasElement, webrtc });
            console.log("Input devices initialized successfully");
        } catch (error) {
            console.error("Failed to initialize input devices:", error);
        }
    };
  
    /*const initializeGamepad = () => {
      console.log("Initializing gamepad...");
      
      const updateGamepadState = () => {
        const gamepads = navigator.getGamepads();
        const gamepad = gamepads[0];
        if (gamepad) {
          setButtonPressed(gamepad.buttons.findIndex(btn => btn.pressed) !== -1 ? "Button pressed" : null);
          setLeftStickX(Number(gamepad.axes[0].toFixed(2)));
          setLeftStickY(Number(gamepad.axes[1].toFixed(2)));
        }
        requestAnimationFrame(updateGamepadState);
      };
  
      window.addEventListener("gamepadconnected", () => {
        setGamepadConnected(true);
        console.log("Gamepad connected!");
        updateGamepadState();
      });
  
      window.addEventListener("gamepaddisconnected", () => {
        setGamepadConnected(false);
        console.log("Gamepad disconnected!");
      });
    };*/
  
    const lockPlay = async () => {
        const canvasElement = canvas();
        if (!canvasElement || !hasStream()) return;
        try {
            await canvasElement.requestPointerLock();
            await canvasElement.requestFullscreen();
            //initializeGamepad();
            
            if (document.fullscreenElement !== null) {
              if ('keyboard' in navigator && 'lock' in (navigator.keyboard as any)) {
                const keys = [
                  "AltLeft", "AltRight", "Tab", "Escape",
                  "ContextMenu", "MetaLeft", "MetaRight"
                ];

                try {
                  await (navigator.keyboard as any).lock(keys);
                  setNestriLock(true);
                  console.log("Keyboard lock acquired");
                } catch (e) {
                  console.warn("Keyboard lock failed:", e);
                  setNestriLock(false);
                }
              }
            }
            
        } catch (error) {
            console.error("Error during lock sequence:", error);
        }
        };
  
    const setupPointerLockListener = () => {
      document.addEventListener("pointerlockchange", () => {
        const canvasElement = canvas();
        if (!canvasElement) return;
        if (document.pointerLockElement === canvasElement) {
          initializeInputDevices();
        } else {
          
          if (!showBannerModal) {
            const playing = sessionStorage.getItem("showedBanner");
            setShowBannerModal(!playing || playing !== "true");
            setShowButtonModal(playing === "false");
          }

          

          nestriKeyboard?.dispose();
          nestriMouse?.dispose();
        }
      });
    };

    const handleVideoInput = async () => {
        const canvasElement = canvas();
        if (!video || !canvasElement) return;
    
        try {
            
            await video.play();
            if (canvasElement && video) {
                canvasElement.width = video.videoWidth;
                canvasElement.height = video.videoHeight;
        
        
                const ctx = canvasElement.getContext("2d");
                const renderer = () => {
                if (ctx && hasStream() && video) {
                    ctx.drawImage(video, 0, 0);
                    video.requestVideoFrameCallback(renderer);
                }
                };
        
                video.requestVideoFrameCallback(renderer);
            }
            } catch (error) {
            console.error("Error playing video:", error);
        }
      };
    
  
    onMount(() => {
      const canvasElement = canvas();
      if(!canvasElement) return;

      setupPointerLockListener();
      video = document.createElement("video");
      video.style.visibility = "hidden";
      webrtc = new WebRTCStream("https://relay.dathorse.com", id, async (mediaStream) => {
        if (video && mediaStream) {
          video.srcObject = mediaStream;
          setHasStream(true);
          setShowOffline(false);
          await handleVideoInput();
        } else if (mediaStream === null) {
          console.log("MediaStream is null, Room is offline");
          setShowOffline(true);
          setHasStream(false);

          const ctx = canvasElement.getContext("2d");
          if (ctx) ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
        } else if (video && video.srcObject !== null) {
          setHasStream(true);
          setShowOffline(true);
          await handleVideoInput();
        }
      });
    });
  
    onCleanup(() => {
      nestriKeyboard?.dispose();
      nestriMouse?.dispose();
    });
  
    return (
      <FullScreen>
        {showOffline() ? (
          <div class="w-screen h-screen flex justify-center items-center">
            <span class="text-2xl font-semibold flex items-center gap-2">Offline</span>
            <button onClick={() =>setShowButtonModal(true)}>Show Modal</button>
          </div>
        ) : (
          <canvas ref={setCanvas} onClick={lockPlay} class="aspect-video h-full w-full object-contain max-h-screen" />
        )}

        <Modal show={showButtonModal}
        setShow={setShowButtonModal}
        closeOnBackdropClick={false}
        handleVideoInput={handleVideoInput}
        lockPlay={lockPlay} />
      </FullScreen>
    );
  }

  interface ModalProps {
    show: () => boolean;
    setShow: (value: boolean) => void;
    closeOnBackdropClick?: boolean;
    handleVideoInput?: () => Promise<void>;
    lockPlay?: () => Promise<void>;
  }

  function Modal(props: ModalProps) {
    return (
      <Show when={props.show()}>
        <div
          class="fixed inset-0 flex items-center justify-center dark:backdrop:bg-[#0009] backdrop:bg-[#b3b5b799] backdrop:backdrop-grayscale-[.3]"
          onClick={() => props.closeOnBackdropClick && props.setShow(false)}
        >
          <div
            class="
            w-full max-w-[370px] max-h-[75vh] rounded-xl border dark:border-[#343434] border-[#e2e2e2]
            dark:[box-shadow:0_0_0_1px_rgba(255,255,255,0.08),_0_3.3px_2.7px_rgba(0,0,0,.1),0_8.3px_6.9px_rgba(0,0,0,.13),0_17px_14.2px_rgba(0,0,0,.17),0_35px_29.2px_rgba(0,0,0,.22),0px_-4px_4px_0px_rgba(0,0,0,.04)_inset] dark:bg-[#222b]
            [box-shadow:0_0_0_1px_rgba(19,21,23,0.08),_0_3.3px_2.7px_rgba(0,0,0,.03),0_8.3px_6.9px_rgba(0,0,0,.04),0_17px_14.2px_rgba(0,0,0,.05),0_35px_29.2px_rgba(0,0,0,.06),0px_-4px_4px_0px_rgba(0,0,0,.07)_inset] bg-[#fffd]
            backdrop-blur-lg py-4 px-5 modal"
            onClick={(e) => e.stopPropagation()} // Prevent closing when clicking inside modal
          >
            <div class="size-full flex flex-col">
              <div class="flex flex-col gap-3">
                <button
                  class="transition-all duration-200 focus:ring-2 focus:ring-gray-300 focus:dark:ring-gray-700 outline-none w-full hover:bg-gray-300 hover:dark:bg-gray-700 bg-gray-200 dark:bg-gray-800 text-gray-800 dark:text-gray-200 items-center justify-center font-medium font-title rounded-lg flex py-3 px-4"
                  onClick={async () => {
                    props.setShow(false);
                    sessionStorage.setItem("showedBanner", "true");
                    await props.handleVideoInput?.();
                    await props.lockPlay?.();
                  }}
                >
                  Continue Playing
                </button>
                <button
                  class="transition-all duration-200 focus:ring-2 focus:ring-gray-300 focus:dark:ring-gray-700 outline-none w-full hover:bg-gray-300 hover:dark:bg-gray-700 bg-gray-200 dark:bg-gray-800 text-gray-800 dark:text-gray-200 items-center justify-center font-medium font-title rounded-lg flex py-3 px-4"
                >
                  Shutdown Nestri
                </button>
              </div>
            </div>
          </div>
        </div>
      </Show>
    );
  }