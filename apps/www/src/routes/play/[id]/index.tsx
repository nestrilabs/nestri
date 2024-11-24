import { useLocation } from "@builder.io/qwik-city";
import {Keyboard, Mouse, WebRTCStream} from "@nestri/input"
import { component$, useSignal, useVisibleTask$ } from "@builder.io/qwik";

export default component$(() => {
    const id = useLocation().params.id;
    const canvas = useSignal<HTMLCanvasElement>();

    useVisibleTask$(({ track }) => {
        track(() => canvas.value);

        if (!canvas.value) return; // Ensure canvas is available

        // Create video element and make it output to canvas (TODO: improve this)
        let video = document.getElementById("webrtc-video-player");
        if (!video) {
            video = document.createElement("video");
            video.id = "stream-video-player";
            video.style.visibility = "hidden";
            const webrtc = new WebRTCStream("https://relay.dathorse.com"); // or http://localhost:8088
            webrtc.connect(id).then(() => {
                const mediaStream = webrtc.getMediaStream();
                console.log("Setting mediastream");
                if (video && mediaStream) {
                    (video as HTMLVideoElement).srcObject = mediaStream;
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
                                    if (ctx) {
                                        ctx.drawImage((video as HTMLVideoElement), 0, 0);
                                        requestAnimationFrame(renderer);
                                    }
                                }
                                requestAnimationFrame(renderer);
                            }
                        });

                        document.addEventListener("pointerlockchange", (e) => {
                            if (!canvas.value) return; // Ensure canvas is available
                            // @ts-ignore
                            if (document.pointerLockElement && !window.nestrimouse && !window.nestrikeyboard) {
                                // @ts-ignore
                                window.nestrimouse = new Mouse({canvas: canvas.value, webrtc}, false); //< TODO: Make absolute mode toggleable, for now feels better?
                                // @ts-ignore
                                window.nestrikeyboard = new Keyboard({canvas: canvas.value, webrtc});
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
                            }
                        });
                    };

                    document.body.append(playbtn);
                }
            });
        }
    })

    return (
        <canvas
            ref={canvas}
            onClick$={async () => {
                if (canvas.value) {
                    // await element.value.requestFullscreen()
                    // Do not use - unadjustedMovement: true - breaks input on linux
                    canvas.value.requestPointerLock();
                }
            }}
            //TODO: go full screen, then lock on "landscape" screen-orientation on mobile
            class="aspect-video h-full w-full object-contain max-h-screen"/>
    )
})

{/**
    .spinningCircleInner_b6db20 {
    transform: rotate(280deg);
}
.inner_b6db20 {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    contain: paint;
} */}

{/* <div class="loadingPopout_a8c724" role="dialog" tabindex="-1" aria-modal="true"><div class="spinner_b6db20 spinningCircle_b6db20" role="img" aria-label="Loading"><div class="spinningCircleInner_b6db20 inner_b6db20"><svg class="circular_b6db20" viewBox="25 25 50 50"><circle class="path_b6db20 path3_b6db20" cx="50" cy="50" r="20"></circle><circle class="path_b6db20 path2_b6db20" cx="50" cy="50" r="20"></circle><circle class="path_b6db20" cx="50" cy="50" r="20"></circle></svg></div></div></div> */ }
// .loadingPopout_a8c724 {
//     background-color: var(--background-secondary);
//     display: flex;
//     justify-content: center;
//     padding: 8px;
// }

// .circular_b6db20 {
//     animation: spinner-spinning-circle-rotate_b6db20 2s linear infinite;
//     height: 100%;
//     width: 100%;
// }

// 100% {
//     transform: rotate(360deg);
// }


{/* .path3_b6db20 {
    animation-delay: .23s;
    stroke: var(--text-brand);
}
.path_b6db20 {
    animation: spinner-spinning-circle-dash_b6db20 2s ease-in-out infinite;
    stroke-dasharray: 1, 200;
    stroke-dashoffset: 0;
    fill: none;
    stroke-width: 6;
    stroke-miterlimit: 10;
    stroke-linecap: round;
    stroke: var(--brand-500);
}
circle[Attributes Style] {
    cx: 50;
    cy: 50;
    r: 20;
}
user agent stylesheet
:not(svg) {
    transform-origin: 0px 0px;
} */}



// .path2_b6db20 {
//     animation-delay: .15s;
//     stroke: var(--text-brand);
//     opacity: .6;
// }
// .path_b6db20 {
//     animation: spinner-spinning-circle-dash_b6db20 2s ease-in-out infinite;
//     stroke-dasharray: 1, 200;
//     stroke-dashoffset: 0;
//     fill: none;
//     stroke-width: 6;
//     stroke-miterlimit: 10;
//     stroke-linecap: round;
//     stroke: var(--brand-500);
// }
// circle[Attributes Style] {
//     cx: 50;
//     cy: 50;
//     r: 20;


// function throttle(func, limit) {
//     let inThrottle;
//     return function(...args) {
//         if (!inThrottle) {
//             func.apply(this, args);
//             inThrottle = true;
//             setTimeout(() => inThrottle = false, limit);
//         }
//     }
// }

// // Use it like this:
// const throttledMouseMove = throttle((x, y) => {
//     websocket.send(JSON.stringify({
//         type: 'mousemove',
//         x: x,
//         y: y
//     }));
// }, 16); // ~60fps

// use std::time::Instant;

// // Add these to your AppState
// struct AppState {
//     pipeline: Arc<Mutex<gst::Pipeline>>,
//     last_mouse_move: Arc<Mutex<(i32, i32, Instant)>>, // Add this
// }

// // Then in your MouseMove handler:
// InputMessage::MouseMove { x, y } => {
//     let mut last_move = state.last_mouse_move.lock().unwrap();
//     let now = Instant::now();
    
//     // Only process if coordinates are different or enough time has passed
//     if (last_move.0 != x || last_move.1 != y) && 
//        (now.duration_since(last_move.2).as_millis() > 16) { // ~60fps
        
//         println!("Mouse moved to x: {}, y: {}", x, y);
        
//         let structure = gst::Structure::builder("MouseMoveRelative")
//             .field("pointer_x", x as f64)
//             .field("pointer_y", y as f64)
//             .build();

//         let event = gst::event::CustomUpstream::new(structure);
//         pipeline.send_event(event);
        
//         // Update last position and time
//         *last_move = (x, y, now);
//     }
// }
