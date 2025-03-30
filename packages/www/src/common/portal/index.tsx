import { createEffect, createSignal } from "solid-js";
import portalbtn, { PortalButton, PortalIcon } from "./button";
import { styled } from "@macaron-css/solid";
import { theme } from "@nestri/www/ui";


const PlayBtn = styled("button", {
    base: {
        position: "relative",
        backgroundColor: "transparent",
        outline: "none",
        border: "none",
        padding: 0,
        margin: 0,
        height: 100,
        borderRadius: 999,
        ":focus":{
            outline:`3px solid ${theme.color.brand}`
        }
    }
})

const CanvasOne = styled("canvas", {
    base: {
        position: "absolute",
        inset: 0,
        // backgroundColor:"red",
        height: "100%",
        width: "100%",
        borderRadius: 999,
    }
})

const CanvasTwo = styled("canvas", {
    base: {
        position: "relative",
        inset: 0,
        // backgroundColor:"red",
        zIndex: 1,
        height: "100%",
        width: "100%",
        borderRadius: 999,
    }
})
export function Portal() {
    const [iconRef, setIconRef] = createSignal<HTMLCanvasElement | undefined>();
    const [buttonRef, setButtonRef] = createSignal<HTMLCanvasElement | undefined>();
    // const [imagesLoaded, setImagesLoaded] = createSignal(false);

    const imageUrls = [
        portalbtn.assets.button_assets["intro"].image,
        portalbtn.assets.button_assets["idle"].image,
        portalbtn.assets.icon_assets["exit"].image,
        portalbtn.assets.icon_assets["intro"].image,
        portalbtn.assets.icon_assets["loop"].image
    ];

    const loadImages = () => {
        return Promise.all(imageUrls.map(url => {
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = (e) => {
                    console.error(`Failed to load image from ${url}:`, e);
                    reject(new Error(`Failed to load image from ${url}`));
                };
                img.src = url;
            });
        }));
    }

    createEffect(() => {

        (async () => {
            const btnRef = buttonRef()
            const icnRef = iconRef()

            if (icnRef && btnRef) {
                const [introImg, idleImg, exitImg, , loopImg] = await loadImages();

                const button = new PortalButton(btnRef);
                const icon = new PortalIcon(icnRef)
                // if (!isMounted) return;

                await button.render("intro", false, introImg as HTMLImageElement);
                await icon.render("exit", false, exitImg as HTMLImageElement, false);
                await button.render("idle", true, idleImg as HTMLImageElement, 3);

                // Intro and loop animation
                await Promise.all([
                    (async () => {
                        if (icnRef) {
                            await icon.render("loop", false, loopImg as HTMLImageElement, true);
                            await icon.render("loop", false, loopImg as HTMLImageElement, true);
                            await icon.render("exit", false, exitImg as HTMLImageElement, true);
                        }
                    })(),
                    button.render("idle", true, idleImg as HTMLImageElement, 2),
                ]);
            }
        })()
    });

    return (
        <PlayBtn autofocus>
            <CanvasOne height={100} width={100} ref={setButtonRef} />
            <CanvasTwo height={100} width={100} ref={setIconRef} />
        </PlayBtn>
    )
}