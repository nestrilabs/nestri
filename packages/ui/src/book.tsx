import { component$ } from "@builder.io/qwik";
import { cn } from "./design";

type Props = {
    bgColor?: string;
    textColor?: string;
    title?: string;
    class?: string;
}
export default component$(({ bgColor = "hsla(0,0%,89%,1)", textColor = "#000", title = "Design Engineering at Vercel", class: className }: Props) => {
    return (
        <div style={{ "--book-width": 196, "--book-default-width": 196, "--book-color": bgColor, "--book-text-color": textColor, "--book-depth": "29cqw", "--hover-rotate": "-20deg", "--hover-scale": 1.066, "--hover-translate-x": "-8px" }} class={cn("[perspective:900px] inline-block w-fit rounded-[6px_4px_4px_6px] group", className)}>
            <div class="aspect-[49/60] w-fit rotate-0 relative [transform-style:preserve-3d] min-w-[calc(var(--book-width)*1px)] [transition:transform_.25s_ease-out] [container-type:inline-size]
            group-hover:[transform:rotateY(var(--hover-rotate))_scale(var(--hover-scale))_translateX(var(--hover-translate-x))] [.flip_&]:[transform:rotateY(var(--hover-rotate))_scale(var(--hover-scale))_translateX(var(--hover-translate-x))]">
                <div class="bg-[--book-color] absolute min-w-[calc(var(--book-width)*1px)] w-[calc(var(--book-width)*1px)] h-full overflow-hidden rounded-[6px_4px_4px_6px] [box-shadow:0_1px_1px_0_rgba(0,0,0,.02),0_4px_8px_-4px_rgba(0,0,0,.1),0_16px_24px_-8px_rgba(0,0,0,.03)] [transform:translateZ(0)]
                after:absolute after:inset-0 after:border after:border-black/[.08] after:w-full after:h-full after:rounded-[inherit] after:[box-shadow:inset_0_1px_2px_0_hsla(0,0%,100%,.3)] after:pointer-events-none">
                    <div
                        style={{
                            boxShadow: "0 1.8px 3.6px rgba(0,0,0,.05),0 10.8px 21.6px rgba(0,0,0,.08),inset 0 -.9px 0 rgba(0,0,0,.1),inset 0 1.8px 1.8px hsla(0,0%,100%,.1),inset 3.6px 0 3.6px rgba(0,0,0,.1)",
                            background: "linear-gradient(180deg,hsla(0,0%,100%,.1) 0,hsla(0,0%,100%,0) 50%,hsla(0,0%,100%,0) 100%),var(--book-color)"
                        }}
                        class="size-full flex">
                        <div
                            style={{ background: "linear-gradient(90deg,hsla(0,0%,100%,0),hsla(0,0%,100%,0) 12%,hsla(0,0%,100%,.25) 29.25%,hsla(0,0%,100%,0) 50.5%,hsla(0,0%,100%,0) 75.25%,hsla(0,0%,100%,.25) 91%,hsla(0,0%,100%,0)),linear-gradient(90deg,rgba(0,0,0,.03),rgba(0,0,0,.1) 12%,transparent 30%,rgba(0,0,0,.02) 50%,rgba(0,0,0,.2) 73.5%,rgba(0,0,0,.5) 75.25%,rgba(0,0,0,.15) 85.25%,transparent)" }}
                            class="mix-blend-overlay opacity-90 min-w-[8.2%] h-full w-[8.2%]" />
                        <div class="flex mt-[5%] flex-col gap-[calc((16px_/_var(--book-default-width))_*_var(--book-width))] p-[6.1%] [container-type:inline-size] w-full">
                            <span
                                style={{ textShadow: "0 .025em .5px color-mix(in srgb,var(--book-color) 80%,#fff 20%),-.02em -.02em .5px color-mix(in srgb,var(--book-color) 80%,#000 20%)" }}
                                class="leading-[1.7rem] text-left font-semibold text-[1.7rem] tracking-[-.02em] text-balance text-[--book-text-color]">{title}</span>
                        </div>
                    </div>
                    <div class="bg-[url(/images/book-texture.avif)] bg-cover absolute inset-0 mix-blend-hard-light rounded-[6px_4px_4px_6px] bg-no-repeat opacity-50 pointer-events-none [filter:brightness(1.1)]" />
                </div>
                <div
                    class="h-[calc(100%-2*3px)] w-[calc(var(--book-depth)-2px)] top-[3px] rounded-[6px_4px_4px_6px] overflow-hidden absolute [transform:translateX(calc(var(--book-width)*1px-var(--book-depth)/2-3px))_rotateY(90deg)_translateX(calc(var(--book-depth)_/_2))]"
                    style={{ background: "repeating-linear-gradient(90deg,#fff,#efefef 1px,#fff 3px,#9a9a9a 0)" }} />
                <div
                    style={{
                        boxShadow: "0 1.8px 3.6px rgba(0,0,0,.05),0 10.8px 21.6px rgba(0,0,0,.08),inset 0 -.9px 0 rgba(0,0,0,.1),inset 0 1.8px 1.8px hsla(0,0%,100%,.1),inset 3.6px 0 3.6px rgba(0,0,0,.1)",
                        background: "linear-gradient(180deg,hsla(0,0%,100%,.1) 0,hsla(0,0%,100%,0) 50%,hsla(0,0%,100%,0) 100%),var(--book-color)"
                    }}
                    class="bg-[--book-color] absolute left-0 w-[calc(var(--book-width)*1px)] h-full rounded-[6px_4px_4px_6px] [transform:translateZ(calc(-1*var(--book-depth)))]" />
            </div>
        </div>
    )
})