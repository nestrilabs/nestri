import PlayIconLoop from "./assets/play_icon_loop.json"
import PlayIconExit from "./assets/play_icon_exit.json"
import PlayIconIntro from "./assets/play_icon_intro.json"
import PlayButtonIdle from "./assets/play_button_idle.json"
import PlayButtonIntro from "./assets/play_button_intro.json"

const button_assets = {
    intro: {
        image: "/src/assets/portal/play_button_intro.png",
        json: PlayButtonIntro
    },
    idle: {
        image: "/src/assets/portal/play_button_idle.png",
        json: PlayButtonIdle
    }
}

const icon_assets = {
    intro: {
        image: "/src/assets/portal/play_icon_intro.png",
        json: PlayIconIntro
    },
    loop: {
        image: "/src/assets/portal/play_icon_loop.png",
        json: PlayIconLoop
    },
    exit: {
        image: "/src/assets/portal/play_icon_exit.png",
        json: PlayIconExit
    }
}

export class PortalButton {
    private canvas: HTMLCanvasElement;
    private currentFrame: number;
    private index: number;
    private buttonQueue: (() => void)[];
    private isButtonRunning: boolean;
    private animationSpeed: number;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.currentFrame = 0;
        this.index = 0;
        this.buttonQueue = [];
        this.isButtonRunning = false;
        this.animationSpeed = 50;
    }

    render(type: "intro" | "idle", loop: boolean, image: HTMLImageElement, index?: number) {
        if (index) this.index = index
        return new Promise<void>((resolve) => {
            const buttonTask = () => {
                // Get the canvas element
                const ctx = this.canvas.getContext('2d');

                // Load the JSON data
                const animationData = button_assets[type].json;

                // Play the animation
                const frames = animationData.frames;
                const totalFrames = frames.length;

                if (this.index) this.currentFrame = this.index;

                const targetDim = 100 //target dimensions of the output image (height, width)

                // Start the animation
                const updateFrame = () => {

                    // Check if we have reached the last frame
                    if (!loop && this.currentFrame === totalFrames - 1) {
                        // Animation has reached the last frame, stop playing
                        this.isButtonRunning = false;

                        // Resolve the Promise to indicate completion
                        resolve();
                        return null;
                    }

                    // Clear the canvas
                    ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);

                    // Get the current frame details
                    const singleFrame = frames[this.currentFrame];
                    const { frame, sourceSize: ss, rotated, spriteSourceSize: sss, trimmed } = singleFrame;

                    this.canvas.width = targetDim;
                    this.canvas.height = targetDim;
                    this.canvas.style.borderRadius = `${ss.h / 2}px`

                    const newSize = {
                        w: frame.w,
                        h: frame.h
                    };

                    const newPosition = {
                        x: 0,
                        y: 0
                    };

                    if (rotated) {
                        ctx?.save()
                        ctx?.translate(this.canvas.width / 2, this.canvas.height / 2)
                        ctx?.rotate(-Math.PI / 2);
                        ctx?.translate(-this.canvas.height / 2, -this.canvas.width / 2);

                        newSize.w = frame.h;
                        newSize.h = frame.w;
                    }

                    if (trimmed) {
                        newPosition.x = sss.x;
                        newPosition.y = sss.y;

                        if (rotated) {
                            newPosition.x = this.canvas.height - sss.h - sss.y;
                            newPosition.y = sss.x;
                        }
                    }

                    const scaleFactor = Math.min(targetDim / newSize.w, targetDim / newSize.h);
                    const scaledWidth = newSize.w * scaleFactor;
                    const scaledHeight = newSize.h * scaleFactor;

                    // Calculate the center position to draw the resized image
                    const x = (targetDim - scaledWidth) / 2;
                    const y = (targetDim - scaledHeight) / 2;

                    ctx?.drawImage(
                        image,
                        frame.x,
                        frame.y,
                        newSize.w,
                        newSize.h,
                        x,
                        y,
                        scaledWidth,
                        scaledHeight
                    )


                    if (rotated) {
                        ctx?.restore()
                    }
                    // Increment the frame index
                    this.currentFrame = (this.currentFrame + 1) % totalFrames

                    // Schedule the next frame update
                    setTimeout(updateFrame, this.animationSpeed);
                };

                return updateFrame()
            }
            // Check if the button function is already running
            if (this.isButtonRunning) {
                // If running, add the button task to the queue
                this.buttonQueue.push(buttonTask);

            } else {
                // If not running, set the flag and execute the button task immediately
                this.isButtonRunning = true;
                buttonTask();
            }
        })
    }
}

export class PortalIcon {
    private canvas: HTMLCanvasElement;
    private currentFrame: number;
    private index: number;
    private iconQueue: (() => void)[];
    private isIconRunning: boolean;
    private animationSpeed: number;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.currentFrame = 0;
        this.index = 0;
        this.iconQueue = [];
        this.isIconRunning = false;
        this.animationSpeed = 50;
    }

    render(type: "loop" | "intro" | "exit", loop: boolean, image: HTMLImageElement, play: boolean) {
        return new Promise<void>((resolve) => {
            const iconTask = () => {
                // Get the canvas element
                const ctx = this.canvas.getContext('2d');

                // Load the JSON data
                const animationData = icon_assets[type].json;

                // Load the image
                // const image = new Image();
                image.src = icon_assets[type].image; // Path to the sprite sheet image

                // Play the animation
                const frames = animationData.frames;
                const totalFrames = frames.length;

                if (!play) {
                    this.currentFrame = totalFrames - 3
                } else { this.currentFrame = 0 }

                // Start the animation
                const updateFrame = () => {

                    // Check if we have reached the last frame
                    if (!loop && this.currentFrame === totalFrames - 1) {
                        // Animation has reached the last frame, stop playing
                        this.isIconRunning = false;

                        // Resolve the Promise to indicate completion
                        resolve();
                        return;
                    }

                    // Clear the canvas
                    ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);

                    // Get the current frame details
                    const singleFrame = frames[this.currentFrame];
                    const { frame, sourceSize: ss, rotated, spriteSourceSize: sss, trimmed } = singleFrame;

                    this.canvas.width = ss.w;
                    this.canvas.height = ss.h
                    this.canvas.style.borderRadius = `${ss.h / 2}px`

                    const newSize = {
                        w: frame.w,
                        h: frame.h
                    };

                    const newPosition = {
                        x: 0,
                        y: 0
                    };

                    if (rotated) {
                        ctx?.save()
                        ctx?.translate(this.canvas.width / 2, this.canvas.height / 2)
                        ctx?.rotate(-Math.PI / 2);
                        ctx?.translate(-this.canvas.height / 2, -this.canvas.width / 2);

                        newSize.w = frame.h;
                        newSize.h = frame.w;
                    }

                    if (trimmed) {
                        newPosition.x = sss.x;
                        newPosition.y = sss.y;

                        if (rotated) {
                            newPosition.x = this.canvas.height - sss.h - sss.y;
                            newPosition.y = sss.x;
                        }
                    }

                    ctx?.drawImage(
                        image,
                        frame.x,
                        frame.y,
                        newSize.w,
                        newSize.h,
                        newPosition.x,
                        newPosition.y,
                        newSize.w,
                        newSize.h
                    )


                    if (rotated) {
                        ctx?.restore()
                    }
                    // Increment the frame index
                    this.currentFrame = (this.currentFrame + 1) % totalFrames


                    // Schedule the next frame update
                    if (!play) {
                        this.isIconRunning = false;

                        resolve();
                        return;
                    }

                    setTimeout(updateFrame, this.animationSpeed)
                };

                return updateFrame();
            }
            // Check if the icon function is already running
            if (this.isIconRunning) {
                // If running, add the button icon to the queue
                this.iconQueue.push(iconTask);
            } else {
                // If not running, set the flag and execute the button task immediately
                this.isIconRunning = true;
                iconTask();
            }
        })
    }

}

const portal = { assets: { button_assets, icon_assets } }
export default portal;