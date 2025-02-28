import { Text } from "@nestri/www/ui/text";
import { createSignal, createEffect, onCleanup, onMount } from "solid-js";
import { useParams } from "@solidjs/router";
import { Modal } from "@nestri/ui";
import { Keyboard, Mouse, WebRTCStream } from "@nestri/input";

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
      setupPointerLockListener();
      video = document.createElement("video");
      video.style.visibility = "hidden";
      webrtc = new WebRTCStream("https://relay.dathorse.com", id, async (mediaStream) => {
        if (video && mediaStream) {
          video.srcObject = mediaStream;
          setHasStream(true);
          setShowOffline(false);
          await handleVideoInput();
        } else {
          setShowOffline(true);
          setHasStream(false);
        }
      });
    });
  
    onCleanup(() => {
      nestriKeyboard?.dispose();
      nestriMouse?.dispose();
    });
  
    return (
      <>
        {showOffline() ? (
          <div class="w-screen h-screen flex justify-center items-center">
            <span class="text-2xl font-semibold flex items-center gap-2">Offline</span>
          </div>
        ) : (
          <canvas ref={setCanvas} onClick={lockPlay} class="aspect-video h-full w-full object-contain max-h-screen" />
        )}
      </>
    );
  }