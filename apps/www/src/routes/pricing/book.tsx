import { component$ } from "@builder.io/qwik";

export default component$(() => {
    return (
        <div style={{ "--book-width": 196, "--book-default-width": 196, "--book-color": "#7DC1C1", "--book-text-color": "#FFF", "--book-depth": "29cqw", "--hover-rotate": "-20deg", "--hover-scale": 1.066, "--hover-translate-x": "-8px" }} class="[perspective:900px] inline-block w-fit group" >
            <div class="aspect-[49/60] w-fit rotate-0 relative [transform-style:preserve-3d] min-w-[calc(var(--book-width)*1px)] [transition:transform_.25s_ease-out] [container-type:inline-size]
            group-hover:[transform:rotateY(var(--hover-rotate))_scale(var(--hover-scale))_translateX(var(--hover-translate-x))]">
                <div class="bg-[--book-color] absolute min-w-[calc(var(--book-width)*1px)] w-[calc(var(--book-width)*1px)] h-full overflow-hidden rounded-[6px_4px_4px_6px] [box-shadow:0_1px_1px_0_rgba(0,0,0,.02),0_4px_8px_-4px_rgba(0,0,0,.1),0_16px_24px_-8px_rgba(0,0,0,.03)] [transform:translateZ(0)]
                after:absolute after:inset-0 after:border after:border-black/[.08] after:w-full after:h-full after:rounded-[inherit] after:[box-shadow:inset_0_1px_2px_0_hsla(0,0%,100%,.3)] after:pointer-events-none">
                    <div class="size-full flex">
                        <div
                            style={{ background: "linear-gradient(90deg,hsla(0,0%,100%,0),hsla(0,0%,100%,0) 12%,hsla(0,0%,100%,.25) 29.25%,hsla(0,0%,100%,0) 50.5%,hsla(0,0%,100%,0) 75.25%,hsla(0,0%,100%,.25) 91%,hsla(0,0%,100%,0)),linear-gradient(90deg,rgba(0,0,0,.03),rgba(0,0,0,.1) 12%,transparent 30%,rgba(0,0,0,.02) 50%,rgba(0,0,0,.2) 73.5%,rgba(0,0,0,.5) 75.25%,rgba(0,0,0,.15) 85.25%,transparent)" }}
                            class="mix-blend-overlay opacity-100 min-w-[8.2%] h-full w-[8.2%]" />
                        <div class="gap-[calc((16px_/_var(--book-default-width))_*_var(--book-width))] p-[6.1%] [container-type:inline-size] w-full">
                            <span
                                style={{ textShadow: "0 .025em .5px color-mix(in srgb,var(--book-color) 80%,#fff 20%),-.02em -.02em .5px color-mix(in srgb,var(--book-color) 80%,#000 20%)" }}
                                class="leading-[1.25em] font-semibold text-[12cqw] tracking-[-.02em] text-balance text-[--book-text-color]">Design Engineering at Vercel</span>
                            <div class="">
                                <svg fill="none" height="56" viewBox="0 0 36 56" width="36" xmlns="http://www.w3.org/2000/svg"><path clip-rule="evenodd" d="M3.03113 28.0005C6.26017 23.1765 11.7592 20.0005 18 20.0005C24.2409 20.0005 29.7399 23.1765 32.9689 28.0005C29.7399 32.8244 24.2409 36.0005 18 36.0005C11.7592 36.0005 6.26017 32.8244 3.03113 28.0005Z" fill="#0070F3" fill-rule="evenodd"></path><path clip-rule="evenodd" d="M32.9691 28.0012C34.8835 25.1411 36 21.7017 36 18.0015C36 8.06034 27.9411 0.00146484 18 0.00146484C8.05887 0.00146484 0 8.06034 0 18.0015C0 21.7017 1.11648 25.1411 3.03094 28.0012C6.25996 23.1771 11.7591 20.001 18 20.001C24.2409 20.001 29.74 23.1771 32.9691 28.0012Z" fill="#45DEC4" fill-rule="evenodd"></path><path clip-rule="evenodd" d="M32.9692 28.0005C29.7402 32.8247 24.241 36.001 18 36.001C11.759 36.001 6.25977 32.8247 3.03077 28.0005C1.11642 30.8606 0 34.2999 0 38C0 47.9411 8.05887 56 18 56C27.9411 56 36 47.9411 36 38C36 34.2999 34.8836 30.8606 32.9692 28.0005Z" fill="#E5484D" fill-rule="evenodd"></path></svg>
                            </div>
                        </div>
                    </div>
                    <div class="bg-[url(https://assets.vercel.com/image/upload/v1720554484/front/design/book-texture.avif)] bg-cover absolute inset-0 mix-blend-hard-light rounded-[6px_4px_4px_6px] bg-no-repeat opacity-50 pointer-events-none [filter:brightness(1.1)]" />
                </div>
                <div
                    class="h-[calc(100%-2*3px)] w-[calc(var(--book-depth)-2px)] top-[3px] absolute [transform:translateX(calc(var(--book-width)*1px-var(--book-depth)/2-3px))_rotateY(90deg)_translateX(calc(var(--book-depth)_/_2))]"
                    style={{ background: "repeating-linear-gradient(90deg,#fff,#efefef 1px,#fff 3px,#9a9a9a 0)" }} />
                <div class="bg-[--book-color] absolute left-0 w-[calc(var(--book-width)*1px)] h-full rounded-[6px_4px_4px_6px] [transform:translateZ(calc(-1*var(--book-depth)))]" />
            </div>
        </div>
    )
})