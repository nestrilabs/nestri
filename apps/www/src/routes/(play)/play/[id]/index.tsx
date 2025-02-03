import posthog from "posthog-js";
import { Modal } from "@nestri/ui";
import { useLocation } from "@builder.io/qwik-city";
import { Keyboard, Mouse, WebRTCStream } from "@nestri/input"
import { $, component$, useSignal, useVisibleTask$ } from "@builder.io/qwik";

//TODO: go full screen, then lock on "landscape" screen-orientation on mobile

export default component$(() => {
  const id = useLocation().params.id;
  const canvas = useSignal<HTMLCanvasElement>();
  const showStartingModal = useSignal(false)

  const startPlaying = $(() => {
    sessionStorage.setItem("playing", "true")
    posthog.capture("user_started_playing")
  })

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track }) => {
    track(() => canvas.value);

    if (!canvas.value) return; // Ensure canvas is available
    // if (!showStartingModal.value) {
    //   showStartingModal.value = true
    // }


    // Create video element and make it output to canvas (TODO: improve this)
    let video = document.getElementById("webrtc-video-player");
    try {
      if (!video) {
        video = document.createElement("video");
        video.id = "stream-video-player";
        video.style.visibility = "hidden";
        const webrtc = new WebRTCStream("https://relay.dathorse.com", id, (mediaStream) => {
          if (video && mediaStream && (video as HTMLVideoElement).srcObject === null) {
            console.log("Setting mediastream");
            (video as HTMLVideoElement).srcObject = mediaStream;

            // @ts-ignore
            window.hasstream = true;
            // @ts-ignore
            window.roomOfflineElement?.remove();
            // @ts-ignore
            window.playbtnelement?.remove();

            // showModal.value = true

            const playbtn = document.createElement("button");
            playbtn.style.position = "absolute";
            playbtn.style.left = "50%";
            playbtn.style.top = "50%";
            playbtn.style.transform = "translateX(-50%) translateY(-50%)";
            playbtn.style.width = "12rem";
            playbtn.style.height = "6rem";
            playbtn.style.borderRadius = "1rem";
            playbtn.style.backgroundColor = "rgb(175, 50, 50)";
            playbtn.style.color = "black";
            playbtn.style.fontSize = "1.5em";
            playbtn.textContent = "< Start >";

            playbtn.onclick = () => {
              playbtn.remove();
              (video as HTMLVideoElement).play().then(() => {
                if (canvas.value) {
                  canvas.value.width = (video as HTMLVideoElement).videoWidth;
                  canvas.value.height = (video as HTMLVideoElement).videoHeight;

                  const ctx = canvas.value.getContext("2d");
                  const renderer = () => {
                    // @ts-ignore
                    if (ctx && window.hasstream) {
                      ctx.drawImage((video as HTMLVideoElement), 0, 0);
                      (video as HTMLVideoElement).requestVideoFrameCallback(renderer);
                    }
                  }
                  (video as HTMLVideoElement).requestVideoFrameCallback(renderer);
                }
              });

              document.addEventListener("pointerlockchange", () => {
                if (!canvas.value) return; // Ensure canvas is available
                // @ts-ignore
                if (document.pointerLockElement && !window.nestrimouse && !window.nestrikeyboard) {
                  // @ts-ignore
                  window.nestrimouse = new Mouse({ canvas: canvas.value, webrtc });
                  // @ts-ignore
                  window.nestrikeyboard = new Keyboard({ canvas: canvas.value, webrtc });
                  // @ts-ignore
                } else if (!document.pointerLockElement && window.nestrimouse && window.nestrikeyboard) {
                  // @ts-ignore
                  window.nestrimouse.dispose();
                  // @ts-ignore
                  window.nestrimouse = undefined;
                  // @ts-ignore
                  window.nestrikeyboard.dispose();
                  // @ts-ignore
                  window.nestrikeyboard = undefined;
                  // @ts-ignore
                  window.nestriLock = undefined;
                }
              });
            };
            document.body.append(playbtn);
            // @ts-ignore
            window.playbtnelement = playbtn;
          } else if (mediaStream === null) {
            console.log("MediaStream is null, Room is offline");
            // @ts-ignore
            window.playbtnelement?.remove();
            // @ts-ignore
            window.roomOfflineElement?.remove();
            // Add a message to the screen
            const offline = document.createElement("div");
            offline.style.position = "absolute";
            offline.style.left = "50%";
            offline.style.top = "50%";
            offline.style.transform = "translateX(-50%) translateY(-50%)";
            offline.style.width = "auto";
            offline.style.height = "auto";
            offline.style.color = "lightgray";
            offline.style.fontSize = "2em";
            offline.textContent = "Offline";
            document.body.append(offline);
            // @ts-ignore
            window.roomOfflineElement = offline;
            // @ts-ignore
            window.hasstream = false;
            // Clear canvas if it has been set
            if (canvas.value) {
              const ctx = canvas.value.getContext("2d");
              if (ctx) ctx.clearRect(0, 0, canvas.value.width, canvas.value.height);
            }
          } else if ((video as HTMLVideoElement).srcObject !== null) {
            console.log("Setting new mediastream");
            (video as HTMLVideoElement).srcObject = mediaStream;
            // @ts-ignore
            window.hasstream = true;
            // Start video rendering
            (video as HTMLVideoElement).play().then(() => {
              // @ts-ignore
              window.roomOfflineElement?.remove();
              if (canvas.value) {
                canvas.value.width = (video as HTMLVideoElement).videoWidth;
                canvas.value.height = (video as HTMLVideoElement).videoHeight;

                const ctx = canvas.value.getContext("2d");
                const renderer = () => {
                  // @ts-ignore
                  if (ctx && window.hasstream) {
                    ctx.drawImage((video as HTMLVideoElement), 0, 0);
                    (video as HTMLVideoElement).requestVideoFrameCallback(renderer);
                  }
                }
                (video as HTMLVideoElement).requestVideoFrameCallback(renderer);
              }
            });
          }
        });
      }
    } catch (error) {
      console.log("error handling the media connection", error)
    }
  })

  return (
    <>
      <canvas
        ref={canvas}
        onClick$={async () => {
          // @ts-ignore
          if (canvas.value && window.hasstream && !window.nestriLock) {
            // Do not use - unadjustedMovement: true - breaks input on linux
            await canvas.value.requestPointerLock();
            await canvas.value.requestFullscreen()
            if (document.fullscreenElement !== null) {
              // @ts-ignore
              if ('keyboard' in window.navigator && 'lock' in window.navigator.keyboard) {
                const keys = [
                  "AltLeft",
                  "AltRight",
                  "Tab",
                  "Escape",
                  "ContextMenu",
                  "MetaLeft",
                  "MetaRight"
                ];
                console.log("requesting keyboard lock");
                // @ts-ignore
                window.navigator.keyboard.lock(keys).then(
                  () => {
                    console.log("keyboard lock success");
                    // @ts-ignore
                    window.nestriLock = true;
                  }
                ).catch(
                  (e: any) => {
                    console.log("keyboard lock failed: ", e);
                    // @ts-ignore
                    window.nestriLock = false;
                  }
                )
              } else {
                console.log("keyboard lock not supported, navigator is: ", window.navigator, navigator);
                // @ts-ignore
                window.nestriLock = undefined;
              }
            }
          }
        }}
        class="aspect-video h-full w-full object-contain max-h-screen" />
      <Modal.Root bind:show={showStartingModal} closeOnBackdropClick={false}>
        <Modal.Panel class="
    dark:backdrop:bg-[#0009] backdrop:bg-[#b3b5b799] backdrop:backdrop-grayscale-[.3] w-full max-w-[37%] max-h-[75vh] rounded-xl border dark:border-[#343434] border-[#e2e2e2]
        dark:[box-shadow:0_0_0_1px_rgba(255,255,255,0.08),_0_3.3px_2.7px_rgba(0,0,0,.1),0_8.3px_6.9px_rgba(0,0,0,.13),0_17px_14.2px_rgba(0,0,0,.17),0_35px_29.2px_rgba(0,0,0,.22),0px_-4px_4px_0px_rgba(0,0,0,.04)_inset] dark:bg-[#222b] 
        [box-shadow:0_0_0_1px_rgba(19,21,23,0.08),_0_3.3px_2.7px_rgba(0,0,0,.03),0_8.3px_6.9px_rgba(0,0,0,.04),0_17px_14.2px_rgba(0,0,0,.05),0_35px_29.2px_rgba(0,0,0,.06),0px_-4px_4px_0px_rgba(0,0,0,.07)_inset] bg-[#fffd] 
        backdrop-blur-lg py-4 px-5 modal" >
          {/* w-[340px] */}
          <div class="size-full flex flex-col">
            <div class="dark:text-white text-black">
              <h3 class="font-semibold text-2xl tracking-tight mb-2 font-title">Important information from Nestri</h3>
              <div class="text-sm dark:text-white/[.79] text-[rgba(19,21,23,0.64)]" >
                Download and install Nestri on your remote server or computer to connect it. Then paste the generated machine id here.
              </div>
            </div>
            <div class="sm:pt-10 sm:block hidden" >
              <button onClick$={startPlaying} class="gap-3 outline-none hover:[box-shadow:0_0_0_2px_rgba(200,200,200,0.95),0_0_0_4px_#8f8f8f] dark:hover:[box-shadow:0_0_0_2px_#161616,0_0_0_4px_#707070] focus:[box-shadow:0_0_0_2px_rgba(200,200,200,0.95),0_0_0_4px_#8f8f8f] dark:focus:[box-shadow:0_0_0_2px_#161616,0_0_0_4px_#707070] [transition:all_0.3s_cubic-bezier(0.4,0,0.2,1)] font-medium font-title rounded-lg flex h-[calc(2.25rem+2*1px)] flex-col text-white w-full leading-none truncate bg-primary-500 items-center justify-center" >
                Continue
              </button>
            </div>
          </div>
        </Modal.Panel>
      </Modal.Root>
    </>
  )
})