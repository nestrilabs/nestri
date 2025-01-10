import { component$ } from "@builder.io/qwik";
import { MotionComponent } from "@nestri/ui/react";

const dimensions = [
    {
        y: "-14%",
        z: -20,
        scale: .7
    }, {
        y: "-14%",
        z: -10,
        scale: 0.8
    },
    {
        scale: 0.9,
        y: "-11%",
    },
    {
        y: "-5%",
        z: 10
    },
]

const games = [{
    id: 1085220,
    name: "Figment 2: Creed Valley",
    image: "https://assets-prd.ignimgs.com/2021/12/15/figment-2-button-1639602944843.jpg"
}, {
    id: 1568400,
    name: "Sheepy: A Short Adventure",
    image: "https://assets-prd.ignimgs.com/2024/04/08/sheepy-1712557253260.jpg"
}, {
    id: 271590,
    name: "Grand Theft Auto V",
    image: "https://assets-prd.ignimgs.com/2021/12/17/gta-5-button-2021-1639777058682.jpg"
}, {
    id: 1086940,
    name: "Baldur's Gate 3",
    image: "https://assets-prd.ignimgs.com/2023/08/24/baldursg3-1692894717196.jpeg"
}, {
    id: 1091500,
    name: "Cyberpunk 2077",
    image: "https://assets-prd.ignimgs.com/2020/07/16/cyberpunk-2077-button-fin-1594877291453.jpg"
}, {
    id: 221100,
    name: "DayZ",
    image: "https://assets-prd.ignimgs.com/2021/12/20/dayz-1640044421966.jpg"
},
]

export default component$(() => {
    return (
        <div class="mx-auto w-screen px-4 max-w-[750px] py-20">
            <div class="[grid-template-columns:repeat(auto-fill,minmax(9rem,1fr))] grid gap-x-5 gap-y-6 py-4">
                {new Array(6).fill(0).map((_, key) => (
                    <button key={key} class="relative max-w-[15rem] w-full h-full rounded-2xl" >
                        <div class="pt-[12%] relative [perspective:100rem] [perspective-origin:50%_75%]" >
                            <div class="relative mx-3 [transform-style:preserve-3d] [transition:.3s_cubic-bezier(0.4,0,0.2,1)]">
                                {new Array(4).fill(0).map((_, key) => (
                                    <MotionComponent
                                        style={{
                                            translateY: dimensions[key].y,
                                            scale: dimensions[key].scale,
                                            translateZ: dimensions[key].z
                                        }}
                                        key={key}
                                        class="absolute w-full [transform-style:preserve-3d] [transform-origin:50%_0%]">
                                        <div class="w-full bg-[#13370f0a] relative overflow-hidden rounded-lg pb-[100%]">
                                            <img class="absolute top-0 left-0 bottom-0 right-0 object-cover" height={140} width={140} src={games[key].image} />
                                        </div>
                                    </MotionComponent>
                                ))}
                                <div class="opacity-0 [transform:translateY(5%)_translateZ(20px)_scale(0.8)] blur-sm relative block [transform-style:preserve-3d] [transform-origin:50%_0%] w-full">
                                    <div class="w-full bg-[#13370f0a] relative overflow-hidden rounded-lg pb-[100%]">
                                        <img class="absolute top-0 left-0 bottom-0 right-0 object-cover" height={140} width={140} src="https://assets-prd.ignimgs.com/2020/07/16/cyberpunk-2077-button-fin-1594877291453.jpg" />
                                    </div>
                                </div>
                            </div>
                            <div class="fixed min-h-12 left-0 right-0 bottom-0 w-full rounded-t-[0.5rem] 
                        rounded-b-[1rem] bg-[linear-gradient(rgba(242,242,242,0.7)_0%,rgb(242,242,242)_91.67%)] dark:bg-[linear-gradient(rgba(48,48,48,0.7)_0%,rgb(7,7,7)_100%)] backdrop-blur-[0.5rem] dark:[box-shadow:rgba(255,255,255,0.1)_0px_2px_2px_0px_inset,rgba(0,0,0,0.25)_0px_7px_16px_0px,rgba(255,255,255,0.1)_0px_0px_20px_0px_inset,rgba(255,255,255,0.1)_0px_0px_3px_0px_inset]
                        backdrop-saturate-[1.5] backdrop-brightness-[0.9] text-[rgba(19,21,23,0.64)] dark:text-[hsla(0,0%,100%,.79)] flex items-center justify-center
                        [box-shadow:rgb(255,255,255)_0px_0px_20px_0px_inset,rgb(255,255,255)_0px_0px_3px_0px_inset,rgba(0,0,0,0.05)_0px_-4px_4px_0px_inset,rgba(0,0,0,0.25)_0px_0px_1px_0px,rgba(0,0,0,0.05)_0px_7px_16px_0px]">
                                <span class="text-sm font-medium px-3 break-words text-wrap">Party</span>
                            </div>
                        </div>
                    </button>
                ))}
            </div>
        </div>
    )
})