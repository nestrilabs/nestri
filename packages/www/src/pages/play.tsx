import { Text } from "@nestri/www/ui/text";
import { createSignal, createEffect, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { useParams } from "@solidjs/router";
import { Keyboard, Mouse, WebRTCStream } from "@nestri/input";
import { Container, FullScreen } from "@nestri/www/ui/layout";
import { styled } from "@macaron-css/solid";
import { lightClass, theme, darkClass } from "@nestri/www/ui/theme";

const Canvas = styled("canvas", {
  base: {
    aspectRatio: 16 / 9,
    width: "100%",
    height: "100%",
    objectFit: "contain",
    maxHeight: "100vh",
  }
});

const ModalContainer = styled("div", {
  base: {
    width: "100%",
    maxWidth: 370,
    maxHeight: "75vh",
    height: "auto",
    // borderRadius: 12,
    // borderWidth: 1,
    // borderStyle: "solid",
    // borderColor: theme.color.gray.d400,
    // backgroundColor: theme.color.pink.d400,
    backgroundColor: theme.color.red.d300,
    // boxShadow: theme.color.boxShadow,
    // backdropFilter: "blur(20px)",
    padding: "20px 25px"
  }
})

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
  let nestriMouse: Mouse, nestriKeyboard: Keyboard;

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
    if (!canvasElement) return;

    setupPointerLockListener();
    video = document.createElement("video");
    video.style.visibility = "hidden";
    webrtc = new WebRTCStream("http://192.168.1.200:8088", id, async (mediaStream) => {
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

  const { Modal, openModal } = createModal();

  return (
    <>
      <button type="button" onClick={openModal}>
        open modal
      </button>
      <Modal />
    </>
    /*<FullScreen>
      {showOffline() ? (
        <div class="w-screen h-screen flex justify-center items-center">
          <span class="text-2xl font-semibold flex items-center gap-2">Offline</span>
          <button onClick={() =>setShowButtonModal(true)}>Show Modal</button>
        </div>
      ) : (
        <Canvas ref={setCanvas} onClick={lockPlay}/>
      )}

      <Modal show={showButtonModal}
      setShow={setShowButtonModal}
      closeOnBackdropClick={false}
      handleVideoInput={handleVideoInput}
      lockPlay={lockPlay} />
    </FullScreen>*/
  );
}

interface ModalProps {
  show: () => boolean;
  setShow: (value: boolean) => void;
  closeOnBackdropClick?: boolean;
  handleVideoInput?: () => Promise<void>;
  lockPlay?: () => Promise<void>;
}

function createModal() {
  const [open, setOpen] = createSignal(false);

  return {
    openModal() {
      setOpen(true);
    },
    Modal() {
      return (
        <Portal mount={document.getElementById("styled")!}>
          <Show when={open()}>
              <div
                style={`
                  position: absolute;
                  inset: 0;
                  display: flex;
                  justify-content: center;
                  align-items: center;
                `}
              >
                <ModalContainer>
                  Hello from modal <br />
                  <button onClick={() => setOpen(false)}>close modal</button>
                </ModalContainer>
              </div>
          </Show>
        </Portal>
      );
    },
  };
}

function Modal(props: ModalProps) {
  return (


    <ModalContainer
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
    </ModalContainer>
  );
}