// import posthog from "posthog-js";
import { Modal } from "@nestri/ui";
import { useLocation } from "@builder.io/qwik-city";
import { Keyboard, Mouse, WebRTCStream } from "@nestri/input"
import { $, component$, noSerialize, type NoSerialize, useSignal, useStore, useVisibleTask$ } from "@builder.io/qwik";
// import Nestri from "@nestri/sdk";

//TODO: go full screen, then lock on "landscape" screen-orientation on mobile
// FIXME: Add authentication and authorization
// export const getUserSubscriptions = server$(
//   async function () {

//     const access = this.cookie.get("access_token")
//     if (access) {
//       const bearerToken = access.value

//       const nestriClient = new Nestri({ bearerToken, maxRetries: 5 })
//       const subscriptions = await nestriClient.users.session()

//       return subscriptions as "Free" | "Pro"
//     }
//   }
// );

type PlayState = {
  nestriMouse: NoSerialize<Mouse | undefined>
  nestriKeyboard: NoSerialize<Keyboard | undefined>
  webrtc: NoSerialize<WebRTCStream | undefined>
  nestriLock?: boolean
  hasStream?: boolean
  showOffline?: boolean
  video?: HTMLVideoElement
  inputInitialized?: boolean
  initializedVideo?: boolean
}

export default component$(() => {
  const id = useLocation().params.id;
  const showBannerModal = useSignal(false)
  const showButtonModal = useSignal(false)
  const canvas = useSignal<HTMLCanvasElement>();
  const playState = useStore<PlayState>({
    nestriMouse: undefined,
    nestriKeyboard: undefined,
    nestriLock: undefined,
    webrtc: undefined,
    video: undefined,
    hasStream: undefined,
    showOffline: undefined,
    inputInitialized: false,
    initializedVideo: false
  })

  const initializeInputDevices = $(() => {
    if (!canvas.value || !playState.webrtc || playState.inputInitialized) return;

    try {
      playState.nestriMouse = noSerialize(new Mouse({
        canvas: canvas.value,
        webrtc: playState.webrtc
      }));
      playState.nestriKeyboard = noSerialize(new Keyboard({
        canvas: canvas.value,
        webrtc: playState.webrtc
      }));
      playState.inputInitialized = true;
      console.log("Input devices initialized successfully");
    } catch (error) {
      console.error("Failed to initialize input devices:", error);
      playState.inputInitialized = false;
    }
  });

  const lockPlay = $(async () => {
    if (!canvas.value || !playState.hasStream) return;

    try {
      await canvas.value.requestPointerLock();
      await canvas.value.requestFullscreen();

      if (document.fullscreenElement !== null) {
        if ('keyboard' in navigator && 'lock' in (navigator.keyboard as any)) {
          const keys = [
            "AltLeft", "AltRight", "Tab", "Escape",
            "ContextMenu", "MetaLeft", "MetaRight"
          ];

          try {
            await (navigator.keyboard as any).lock(keys);
            playState.nestriLock = true;
            console.log("Keyboard lock acquired");
          } catch (e) {
            console.warn("Keyboard lock failed:", e);
            playState.nestriLock = false;
          }
        }
      }
    } catch (error) {
      console.error("Error during lock sequence:", error);
    }
  });

  const setupPointerLockListener = $(() => {
    document.addEventListener("pointerlockchange", () => {
      if (!canvas.value) return;

      if (document.pointerLockElement === canvas.value) {
        // Initialize input devices when pointer is locked
        if (!playState.inputInitialized) {
          initializeInputDevices();
        }
      } else {
        if (!showBannerModal.value) {
          const playing = sessionStorage.getItem("showedBanner");
          showBannerModal.value = !playing || playing !== "true";
          showButtonModal.value = playing === "true";
        }

        // Clean up input devices
        if (playState.nestriKeyboard) {
          playState.nestriKeyboard.dispose();
          playState.nestriKeyboard = undefined;
        }
        if (playState.nestriMouse) {
          playState.nestriMouse.dispose();
          playState.nestriMouse = undefined;
        }
        playState.nestriLock = undefined;
        playState.inputInitialized = false;
      }
    });
  });

  const handleVideoInput = $(async () => {
    if (!playState.video) return;
    if (playState.initializedVideo) return;

    await playState.video.play().then(() => {
      if (canvas.value && playState.video) {
        canvas.value.width = playState.video.videoWidth;
        canvas.value.height = playState.video.videoHeight;
        playState.initializedVideo = true

        const ctx = canvas.value.getContext("2d");
        const renderer = () => {
          if (ctx && playState.hasStream && playState.video) {
            ctx.drawImage(playState.video, 0, 0);
            playState.video.requestVideoFrameCallback(renderer);
          }
        };

        playState.video.requestVideoFrameCallback(renderer);
      }
    }).catch(error => {
      console.error("Error playing video:", error);
    });
  });


  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track }) => {
    track(() => canvas.value);
    if (!canvas.value) return; // Ensure canvas is available

    setupPointerLockListener();
    try {
      if (!playState.video) {
        playState.video = document.createElement("video") as HTMLVideoElement
        playState.video.style.visibility = "hidden";
        playState.webrtc = noSerialize(new WebRTCStream("https://relay.dathorse.com", id, async (mediaStream) => {
          if (playState.video && mediaStream && playState.video.srcObject === null) {
            console.log("Setting mediastream");
            playState.video.srcObject = mediaStream;
            playState.hasStream = true;
            playState.showOffline = false;

            const playing = sessionStorage.getItem("showedBanner")
            if (!playing || playing != "true") {
              if (!showBannerModal.value) showBannerModal.value = true
            } else {
              if (!showButtonModal.value) showButtonModal.value = true
            }

            await handleVideoInput();
          } else if (mediaStream === null) {
            console.log("MediaStream is null, Room is offline");
            playState.showOffline = true
            playState.hasStream = false;
            // Clear canvas if it has been set
            if (canvas.value) {
              const ctx = canvas.value.getContext("2d");
              if (ctx) ctx.clearRect(0, 0, canvas.value.width, canvas.value.height);
            }
          } else if (playState.video && playState.video.srcObject !== null) {
            console.log("Setting new mediastream");
            playState.video.srcObject = mediaStream;
            playState.hasStream = true;
            playState.showOffline = true

            playState.video.play().then(() => {
              // window.roomOfflineElement?.remove();
              playState.showOffline = false
              if (canvas.value && playState.video) {
                canvas.value.width = playState.video.videoWidth;
                canvas.value.height = playState.video.videoHeight;

                const ctx = canvas.value.getContext("2d");
                const renderer = () => {
                  if (ctx && playState.hasStream && playState.video) {
                    ctx.drawImage(playState.video, 0, 0);
                    playState.video.requestVideoFrameCallback(renderer);
                  }
                }
                playState.video.requestVideoFrameCallback(renderer);
              }
            });
          }
        }));
      }
    } catch (error) {
      console.log("error handling the media connection", error)
    }
  })

  return (
    <>
      {playState.showOffline ? (
        <div class="w-screen h-screen flex justify-center items-center">
          <span class="text-2xl font-semibold flex items-center gap-2" >
            Offline
          </span>
        </div>
      ) : (
        <>
          < canvas
            ref={canvas}
            onClick$={lockPlay}
            class="aspect-video h-full w-full object-contain max-h-screen" />
          {typeof playState.showOffline === "undefined" && (
            <div class="w-screen h-screen bg-gray-100 dark:bg-gray-900 absolute z-10 flex justify-center items-center">
              <span class="text-xl font-semibold flex items-center gap-2" >
                <div data-component="spinner">
                  <div>
                    {new Array(12).fill(0).map((i, k) => (
                      <div key={k} />
                    ))}
                  </div>
                </div>
                Warming up the GPU...
              </span>
            </div>
          )}
        </>
      )}
      <Modal.Root bind:show={showButtonModal} closeOnBackdropClick={false}>
        <Modal.Panel class="
        dark:backdrop:bg-[#0009] backdrop:bg-[#b3b5b799] backdrop:backdrop-grayscale-[.3] w-full max-w-[370px] max-h-[75vh] rounded-xl border dark:border-[#343434] border-[#e2e2e2]
            dark:[box-shadow:0_0_0_1px_rgba(255,255,255,0.08),_0_3.3px_2.7px_rgba(0,0,0,.1),0_8.3px_6.9px_rgba(0,0,0,.13),0_17px_14.2px_rgba(0,0,0,.17),0_35px_29.2px_rgba(0,0,0,.22),0px_-4px_4px_0px_rgba(0,0,0,.04)_inset] dark:bg-[#222b] 
            [box-shadow:0_0_0_1px_rgba(19,21,23,0.08),_0_3.3px_2.7px_rgba(0,0,0,.03),0_8.3px_6.9px_rgba(0,0,0,.04),0_17px_14.2px_rgba(0,0,0,.05),0_35px_29.2px_rgba(0,0,0,.06),0px_-4px_4px_0px_rgba(0,0,0,.07)_inset] bg-[#fffd] 
            backdrop-blur-lg py-4 px-5 modal" >
          <div class="size-full flex flex-col">
            <div class="flex flex-col gap-3" >
              <button
                onClick$={async () => {
                  showButtonModal.value = false;
                  await handleVideoInput()
                  await lockPlay();
                }}
                class="transition-all duration-200 focus:ring-2 focus:ring-gray-300 focus:dark:ring-gray-700 outline-none w-full hover:bg-gray-300 hover:dark:bg-gray-700 bg-gray-200 dark:bg-gray-800 text-gray-800 dark:text-gray-200 items-center justify-center font-medium font-title rounded-lg flex py-3 px-4" >
                Continue Playing
              </button>
              <button class="transition-all duration-200 focus:ring-2 focus:ring-gray-300 focus:dark:ring-gray-700 outline-none w-full hover:bg-gray-300 hover:dark:bg-gray-700 bg-gray-200 dark:bg-gray-800 text-gray-800 dark:text-gray-200 items-center justify-center font-medium font-title rounded-lg flex py-3 px-4" >
                Shutdown Nestri
              </button>
            </div>
          </div>
        </Modal.Panel>
      </Modal.Root>
      <Modal.Root bind:show={showBannerModal} closeOnBackdropClick={false}>
        <Modal.Panel class="
        dark:backdrop:bg-[#0009] backdrop:bg-[#b3b5b799] backdrop:backdrop-grayscale-[.3] w-full max-w-[37%] max-h-[75vh] rounded-xl border dark:border-[#343434] border-[#e2e2e2]
            dark:[box-shadow:0_0_0_1px_rgba(255,255,255,0.08),_0_3.3px_2.7px_rgba(0,0,0,.1),0_8.3px_6.9px_rgba(0,0,0,.13),0_17px_14.2px_rgba(0,0,0,.17),0_35px_29.2px_rgba(0,0,0,.22),0px_-4px_4px_0px_rgba(0,0,0,.04)_inset] dark:bg-[#222b] 
            [box-shadow:0_0_0_1px_rgba(19,21,23,0.08),_0_3.3px_2.7px_rgba(0,0,0,.03),0_8.3px_6.9px_rgba(0,0,0,.04),0_17px_14.2px_rgba(0,0,0,.05),0_35px_29.2px_rgba(0,0,0,.06),0px_-4px_4px_0px_rgba(0,0,0,.07)_inset] bg-[#fffd] 
            backdrop-blur-lg py-4 px-5 modal" >
          <div class="size-full flex flex-col">
            <div class="dark:text-white text-black">
              <h3 class="font-semibold text-2xl tracking-tight mb-2 font-title">Important information from Nestri</h3>
              <div class="text-sm dark:text-white/[.79] text-[rgba(19,21,23,0.64)]" >
                This product is in Alpha — please share feedback whenever possible to help us improve. Thanks you for your support! 💖
              </div>
            </div>
            <div class="sm:pt-10 sm:block hidden" >
              <button
                onClick$={async () => {
                  sessionStorage.setItem("showedBanner", "true");
                  showBannerModal.value = false;
                  await handleVideoInput()
                  await lockPlay();
                }}
                class="gap-3 outline-none hover:[box-shadow:0_0_0_2px_rgba(200,200,200,0.95),0_0_0_4px_#8f8f8f] dark:hover:[box-shadow:0_0_0_2px_#161616,0_0_0_4px_#707070] focus:[box-shadow:0_0_0_2px_rgba(200,200,200,0.95),0_0_0_4px_#8f8f8f] dark:focus:[box-shadow:0_0_0_2px_#161616,0_0_0_4px_#707070] [transition:all_0.3s_cubic-bezier(0.4,0,0.2,1)] font-medium font-title rounded-lg flex h-[calc(2.25rem+2*1px)] flex-col text-white w-full leading-none truncate bg-primary-500 items-center justify-center" >
                Continue
              </button>
            </div>
          </div>
        </Modal.Panel>
      </Modal.Root>
    </>
  )
})