// FIXME: We need to make from the modal a reusable component
// FIXME: The mousepointer lock is somehow shifted when the window gets resized
import { Text } from "@nestri/www/ui/text";
import { createSignal, createEffect, onCleanup, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { useParams } from "@solidjs/router";
import { Keyboard, Mouse, WebRTCStream } from "@nestri/input";
import { Container, FullScreen } from "@nestri/www/ui/layout";
import { styled } from "@macaron-css/solid";
import { lightClass, theme, darkClass } from "@nestri/www/ui/theme";
import { Modal, createModalController } from "../components/Modal";

const Canvas = styled("canvas", {
  base: {
    aspectRatio: 16 / 9,
    width: "100%",
    height: "100%",
    objectFit: "contain",
    maxHeight: "100vh",
  }
});



const Button = styled("button", {
  base: {
    outline: "none",
    width: "100%",
    backgroundColor: theme.color.background.d100,
    padding: "12px 16px",
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: theme.color.gray.d500,
    ":hover": {
      backgroundColor: theme.color.gray.d300,
    }
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

  const { Modal, openModal } = createModal();
  const { WelcomeModal, openWelcomeModal } = createWelcomeModal();

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
        console.log("Pointer lock lost Show Banner Modal:", showBannerModal());
        if (!showBannerModal()) {
          console.log("Pointer lock lost, showing banner");
          const playing = sessionStorage.getItem("showedBanner");
          setShowBannerModal(!playing || playing !== "true");
          openWelcomeModal();

          if (playing) {
            setShowButtonModal(true);
            openModal();
          }
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
    webrtc = new WebRTCStream("https://relay.dathorse.com", id, async (mediaStream) => {
      if (video && mediaStream) {
        video.srcObject = mediaStream;
        setHasStream(true);
        setShowOffline(false);

        const playing = sessionStorage.getItem("showedBanner")
        console.log("Playing:", playing);
        if (!playing || playing != "true") {
          console.log("Showing banner: ", showBannerModal());
          if (!showBannerModal()) {
            setShowBannerModal(false)
            openWelcomeModal();
          }
        } else {
          if (!showButtonModal()) {
            setShowButtonModal(true)
            openModal();
          }
        }

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

  return (<FullScreen>
    {showOffline() ? (
      <div class="w-screen h-screen flex justify-center items-center">
        <span class="text-2xl font-semibold flex items-center gap-2">Offline</span>
      </div>
    ) : (
      <Canvas ref={setCanvas} onClick={lockPlay} />
    )}

    <WelcomeModal
      show={showBannerModal}
      setShow={setShowBannerModal}
      closeOnBackdropClick={false}
      handleVideoInput={handleVideoInput}
      lockPlay={lockPlay} />

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

type GameModalProps = ModalProps & {
  handleVideoInput?: () => Promise<void>;
  lockPlay?: () => Promise<void>;
  setShow?: (show: boolean) => void;
}

function createWelcomeModal() {
  const controller = createModalController();

  return {
    openWelcomeModal: controller.open,
    WelcomeModal(props: GameModalProps) {
      return (
        <Modal
          isOpen={controller.isOpen()}
          onClose={controller.close}
        >
          <div style={{ display: "flex", "flex-direction": "column", gap: "12px" }}>
            Happy that you use Nestri!
            <Button onClick={async () => {
              sessionStorage.setItem("showedBanner", "true");
              await props.handleVideoInput?.();
              await props.lockPlay?.();
              controller.close();
            }}>Let's go</Button>
          </div>
        </Modal>
      );
    },
  };
}

function createModal() {
  const controller = createModalController();

  return {
    openModal: controller.open,
    Modal(props: GameModalProps) {
      return (
        <Modal
          isOpen={controller.isOpen()}
          onClose={controller.close}
        >
          <div style={{ display: "flex", "flex-direction": "column", gap: "12px" }}>
            <Button onClick={async () => {
              props.setShow?.(false);
              await props.handleVideoInput?.();
              await props.lockPlay?.();
              controller.close();
            }}>Continue Playing</Button>
            <Button onClick={controller.close}>Shutdown Nestri</Button>
          </div>
        </Modal>
      );
    },
  };
}