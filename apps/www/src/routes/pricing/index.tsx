import { component$, useSignal, useVisibleTask$ } from "@builder.io/qwik";
import { TitleSection, MotionComponent, transition } from "@nestri/ui/react";
import { NavBar, Footer, Book } from "@nestri/ui"
import { cn } from "@nestri/ui/design";
//FIXME: Add a FAQ section
// FIXME: Takes too long for the price input radio input to become responsive
const w = 280
const two = (.25 * w) + 14
const three = .5 * w
const four = (.75 * w) - 14
const five = w - 28
const convertToCss = (value: any) => {
    switch (value) {
        case 1:
            return 28
        case 2:
            return two
        case 3:
            return three
        case 4:
            return four
        case 5:
            return five
        default:
            return three;
    }
}

const convertToPrice = (value: any) => {
    switch (value) {
        case 1:
            return [1, 0]
        case 2:
            return [1, 5]
        case 3:
            return [2, 0]
        case 4:
            return [3, 0]
        case 5:
            return [5, 0]
        default:
            return [2, 0];
    }
}

const convertToTitle = (value: any) => {
    switch (value) {
        case 1:
            return "No sweat. Pay what you can and enjoy Nestri."
        case 2:
            return "You've got a deal."
        case 3:
            return "Choose what feels right."
        case 4:
            return "Our hero. Thank you."
        case 5:
            return "Omg! You have no idea how much your support means to us."
        default:
            return "Choose what feels right.";
    }
}

export default component$(() => {
    const priceValue = useSignal(3)
    const audioUrl = new URL('./cash.mp3', import.meta.url).href
    const audio = useSignal<HTMLAudioElement | undefined>()

    return (
        <>
            <NavBar />
            <TitleSection client:load title="Pricing" description={["We're growing at the speed of trust. Choose a price that feels right for you and help support Nestri"]} />
            <MotionComponent
                initial={{ opacity: 0, y: 100 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={transition}
                client:load
                class="flex items-center justify-center w-screen"
                as="div"
            >
                <div class="px-4 w-full" >
                    <section class="flex flex-col gap-4 justify-center items-center mx-auto w-full text-left max-w-2xl pb-4">
                        <div class="flex flex-col gap-4 justify-center items-center">
                            <div class="flex sm:flex-row flex-col w-full h-min p-1.5 overflow-hidden bg-gray-200/70 ring-2 ring-gray-300 dark:ring-gray-700 dark:bg-gray-800/70 rounded-xl">
                                <div class="gap-3 w-full p-3 sm:p-6 flex flex-col rounded-lg ">
                                    <div class="flex items-center font-title h-min w-full justify-between">
                                        <div class="flex items-center justify-center gap-2 ">
                                            <div class="bg-gradient-to-t from-[#d596ff] to-[rgb(145,147,255)] rounded-full h-4 w-4" />
                                            <p class="text-base font-semibold">Individual</p>
                                        </div>
                                    </div>
                                    <div class="break-words [word-break:break-word] [text-wrap:balance] [word-wrap:break-word] w-full relative whitespace-pre-wrap">
                                        <p class="text-base text-gray-950/70 dark:text-gray-50/70">
                                            Perfect for casual gamers and those new to Nestri. Dive into cloud gaming without spending a dime.
                                        </p>
                                    </div>
                                    <div class="flex flex-col w-full">
                                        <p class="text-[4rem] leading-[1] font-medium font-title"> Free </p>
                                        {/**FIXME: Add the link to the docs here */}
                                        <button class="h-[154px] w-full flex items-start pt-4 justify-center overflow-hidden">
                                            <Book textColor="#FFF"
                                                bgColor="#FF4F01"
                                                title="Getting started with Nestri" class="shadow-lg shadow-gray-900 dark:shadow-gray-300" />
                                        </button>
                                        <hr class="h-[2px] bg-gray-400 text-gray-300 dark:bg-gray-600 " />
                                    </div>
                                    <div class="w-full relative sm:text-sm text-base gap-3 flex flex-col">
                                        {/* <div class="flex item-center flex-col gap-2 w-full">
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24"><path fill="currentColor" d="M8.21 17.32L7 16.8a2.13 2.13 0 1 0 1.17-2.93l1.28.53a1.58 1.58 0 0 1-1.22 2.92z" /><path fill="currentColor" d="M12 2a10 10 0 0 0-10 9.34l5.38 2.21a2.31 2.31 0 0 1 .47-.24A2.62 2.62 0 0 1 9 13.1l2.44-3.56a3.8 3.8 0 1 1 3.8 3.8h-.08l-3.51 2.5a2.77 2.77 0 0 1-5.47.68l-3.77-1.6A10 10 0 1 0 12 2" /><path fill="currentColor" d="M17.79 9.5a2.53 2.53 0 1 0-2.53 2.5a2.54 2.54 0 0 0 2.53-2.5m-4.42 0a1.9 1.9 0 1 1 1.9 1.91a1.9 1.9 0 0 1-1.9-1.92z" /></svg>
                                                </div>
                                                <p class="group relative">Add upto&nbsp;<span class="">3 games</span>&nbsp;at a time</p>
                                            </div>
                                        </div> */}
                                        {/* <div class="gap-2.5 flex relative items-center w-full" >
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24">
                                                        <g fill="none" stroke="currentColor" stroke-width="1.5"><path d="M7 10c0-1.414 0-2.121.44-2.56C7.878 7 8.585 7 10 7h4c1.414 0 2.121 0 2.56.44c.44.439.44 1.146.44 2.56v4c0 1.414 0 2.121-.44 2.56c-.439.44-1.146.44-2.56.44h-4c-1.414 0-2.121 0-2.56-.44C7 16.122 7 15.415 7 14z" opacity=".5" />
                                                            <path stroke-linecap="round" stroke-linejoin="round" d="M12.429 10L11 12h2l-1.429 2" />
                                                            <path d="M4 12c0-3.771 0-5.657 1.172-6.828C6.343 4 8.229 4 12 4c3.771 0 5.657 0 6.828 1.172C20 6.343 20 8.229 20 12c0 3.771 0 5.657-1.172 6.828C17.657 20 15.771 20 12 20c-3.771 0-5.657 0-6.828-1.172C4 17.657 4 15.771 4 12Z" />
                                                            <path stroke-linecap="round" d="M4 12H2m20 0h-2M4 9H2m20 0h-2M4 15H2m20 0h-2m-8 5v2m0-20v2M9 20v2M9 2v2m6 16v2m0-20v2" opacity=".5" />
                                                        </g>
                                                    </svg>
                                                </div>
                                                <p>Basic&nbsp;<span class="">datacenter</span>&nbsp;GPU</p>
                                            </div>
                                        </div> */}
                                        {/* <div class="gap-2.5 flex relative items-center w-full" >
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24"><path fill="currentColor" d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2S2 6.477 2 12s4.477 10 10 10" opacity=".5" /><path fill="currentColor" fill-rule="evenodd" d="M12 7.25a.75.75 0 0 1 .75.75v3.69l2.28 2.28a.75.75 0 1 1-1.06 1.06l-2.5-2.5a.75.75 0 0 1-.22-.53V8a.75.75 0 0 1 .75-.75" clip-rule="evenodd" /></svg>
                                                </div>
                                                <p><span class="">3 hours</span>&nbsp;of daily playtime</p>
                                            </div>
                                        </div> */}
                                        <div class="gap-2.5 flex relative items-center w-full" >
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="6" r="4" /><path stroke-linecap="round" d="M18 9c1.657 0 3-1.12 3-2.5S19.657 4 18 4M6 9C4.343 9 3 7.88 3 6.5S4.343 4 6 4" opacity=".5" /><ellipse cx="12" cy="17" rx="6" ry="4" /><path stroke-linecap="round" d="M20 19c1.754-.385 3-1.359 3-2.5s-1.246-2.115-3-2.5M4 19c-1.754-.385-3-1.359-3-2.5s1.246-2.115 3-2.5" opacity=".5" /></g></svg>
                                                </div>
                                                <p>Invite upto&nbsp;<span class="">3 play buddies</span></p>
                                            </div>
                                        </div>
                                        <div class="gap-2.5 flex relative items-center w-full" >
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-full h-full">
                                                        <path fill-rule="evenodd" d="M2 10a.75.75 0 01.75-.75h12.59l-2.1-1.95a.75.75 0 111.02-1.1l3.5 3.25a.75.75 0 010 1.1l-3.5 3.25a.75.75 0 11-1.02-1.1l2.1-1.95H2.75A.75.75 0 012 10z" clip-rule="evenodd"></path>
                                                    </svg>
                                                </div>
                                                <p><span class="">Cross-play</span>&nbsp;with home server</p>
                                            </div>
                                        </div>
                                        <div class="gap-2.5 flex relative items-center w-full" >
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-full h-full">
                                                        <path fill-rule="evenodd" d="M2 10a.75.75 0 01.75-.75h12.59l-2.1-1.95a.75.75 0 111.02-1.1l3.5 3.25a.75.75 0 010 1.1l-3.5 3.25a.75.75 0 11-1.02-1.1l2.1-1.95H2.75A.75.75 0 012 10z" clip-rule="evenodd"></path>
                                                    </svg>
                                                </div>
                                                <p>Frame Rates upto&nbsp;<span class="">120 fps</span></p>
                                            </div>
                                        </div>
                                        <div class="gap-2.5 flex relative items-center w-full" >
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-full h-full">
                                                        <path fill-rule="evenodd" d="M2 10a.75.75 0 01.75-.75h12.59l-2.1-1.95a.75.75 0 111.02-1.1l3.5 3.25a.75.75 0 010 1.1l-3.5 3.25a.75.75 0 11-1.02-1.1l2.1-1.95H2.75A.75.75 0 012 10z" clip-rule="evenodd"></path>
                                                    </svg>
                                                </div>
                                                <p>Video quality upto&nbsp;<span class="">4k UHD</span></p>
                                            </div>
                                        </div>
                                        <div class="gap-2.5 flex relative items-center w-full" >
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-full h-full">
                                                        <path fill-rule="evenodd" d="M2 10a.75.75 0 01.75-.75h12.59l-2.1-1.95a.75.75 0 111.02-1.1l3.5 3.25a.75.75 0 010 1.1l-3.5 3.25a.75.75 0 11-1.02-1.1l2.1-1.95H2.75A.75.75 0 012 10z" clip-rule="evenodd"></path>
                                                    </svg>
                                                </div>
                                                <p><span class="">Unlimited</span>&nbsp;cloud saves</p>
                                            </div>
                                        </div>
                                        <div class="gap-2.5 flex relative items-center w-full" >
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-full h-full">
                                                        <path fill-rule="evenodd" d="M2 10a.75.75 0 01.75-.75h12.59l-2.1-1.95a.75.75 0 111.02-1.1l3.5 3.25a.75.75 0 010 1.1l-3.5 3.25a.75.75 0 11-1.02-1.1l2.1-1.95H2.75A.75.75 0 012 10z" clip-rule="evenodd"></path>
                                                    </svg>
                                                </div>
                                                <p>Unlimited&nbsp;<span class="">State Shares</span>&nbsp;</p>
                                            </div>
                                        </div>
                                        <div class="gap-2.5 flex relative items-center w-full" >
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-full h-full">
                                                        <path fill-rule="evenodd" d="M2 10a.75.75 0 01.75-.75h12.59l-2.1-1.95a.75.75 0 111.02-1.1l3.5 3.25a.75.75 0 010 1.1l-3.5 3.25a.75.75 0 11-1.02-1.1l2.1-1.95H2.75A.75.75 0 012 10z" clip-rule="evenodd"></path>
                                                    </svg>
                                                </div>
                                                <p><span class="">Game mod</span>&nbsp;support</p>
                                            </div>
                                        </div>
                                        <div class="gap-2.5 flex relative items-center w-full" >
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-full h-full">
                                                        <path fill-rule="evenodd" d="M2 10a.75.75 0 01.75-.75h12.59l-2.1-1.95a.75.75 0 111.02-1.1l3.5 3.25a.75.75 0 010 1.1l-3.5 3.25a.75.75 0 11-1.02-1.1l2.1-1.95H2.75A.75.75 0 012 10z" clip-rule="evenodd"></path>
                                                    </svg>
                                                </div>
                                                <p><span class="">Stream</span>&nbsp;to Youtube/Twitch</p>
                                            </div>
                                        </div>
                                    </div>
                                    <button class="bg-white group my-4 max-w-full dark:bg-black text-gray-900/70 hover:ring-primary-500 rounded-lg outline-none dark:text-gray-100/70 ring-2 text-sm h-max ring-gray-300 dark:ring-gray-700 py-2 px-4 flex items-center hover:bg-gray-100 dark:hover:bg-gray-900 transition-all duration-200 focus:bg-primary-100 dark:focus:bg-primary-900 focus:text-primary-500 focus:ring-primary-500 font-title font-bold justify-between">
                                        <p class="overflow-hidden overflow-ellipsis max-w-[210px] text-left whitespace-nowrap font-mono">curl -fsSL https://nestri.io/install | bash</p>
                                        <div class="ml-auto flex items-center">
                                            <svg xmlns="http://www.w3.org/2000/svg" class="group-focus:hidden size-6 flex-shrink-0" width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="M15.24 2h-3.894c-1.764 0-3.162 0-4.255.148c-1.126.152-2.037.472-2.755 1.193c-.719.721-1.038 1.636-1.189 2.766C3 7.205 3 8.608 3 10.379v5.838c0 1.508.92 2.8 2.227 3.342c-.067-.91-.067-2.185-.067-3.247v-5.01c0-1.281 0-2.386.118-3.27c.127-.948.413-1.856 1.147-2.593s1.639-1.024 2.583-1.152c.88-.118 1.98-.118 3.257-.118h3.07c1.276 0 2.374 0 3.255.118A3.6 3.6 0 0 0 15.24 2" /><path fill="currentColor" d="M6.6 11.397c0-2.726 0-4.089.844-4.936c.843-.847 2.2-.847 4.916-.847h2.88c2.715 0 4.073 0 4.917.847S21 8.671 21 11.397v4.82c0 2.726 0 4.089-.843 4.936c-.844.847-2.202.847-4.917.847h-2.88c-2.715 0-4.073 0-4.916-.847c-.844-.847-.844-2.21-.844-4.936z" /></svg>
                                            <svg xmlns="http://www.w3.org/2000/svg" class="group-focus:block hidden text-green-500 size-6 flex-shrink-0" width="20" height="20" viewBox="0 0 24 24"><path fill="currentColor" d="m9.55 15.15l8.475-8.475q.3-.3.7-.3t.7.3t.3.713t-.3.712l-9.175 9.2q-.3.3-.7.3t-.7-.3L4.55 13q-.3-.3-.288-.712t.313-.713t.713-.3t.712.3z" /></svg>
                                        </div>
                                    </button>
                                </div>
                                <div class="gap-3 w-full p-6 flex flex-col rounded-lg bg-white dark:bg-black">
                                    <div class="flex items-center font-title h-min w-full justify-between">
                                        <div class="flex items-center justify-center gap-2 ">
                                            <div class="bg-gradient-to-t from-[#685fea] to-[rgb(153,148,224)] rounded-full h-4 w-4" />
                                            <h1 class="text-base font-semibold">Family</h1>
                                        </div>
                                    </div>
                                    <div class="break-words [word-break:break-word] [text-wrap:balance] [word-wrap:break-word] w-full relative whitespace-pre-wrap">
                                        <p class="text-base text-gray-950/70 dark:text-gray-50/70">
                                            Ideal for dedicated gamers who crave more power, flexibility, and social gaming experiences.
                                        </p>
                                    </div>
                                    <div class="flex flex-col w-full gap-1.5 ">
                                        <div style={{ "--line-height": "4rem" }} class="flex items-end text-[4rem] font-medium font-title">
                                            <div class="flex leading-[1]" >
                                                <span>$</span>
                                                {new Array(2).fill(0).map((_, key) => {
                                                    const [digitOne, digitTwo] = convertToPrice(priceValue.value)
                                                    return (
                                                        <div style={{ "--digit-one": digitOne, "--digit-two": digitTwo }} key={`digit-${key}`} class={cn("h-16 overflow-hidden", key == 0 ? "first-of-type:[--v:var(--digit-one)]" : "last-of-type:[--v:var(--digit-two)]")} >
                                                            <div class={cn("digit_timing flex flex-col", key == 0 ? "items-end" : "items-start")}>
                                                                <div>9</div>
                                                                <div>0</div>
                                                                <div>1</div>
                                                                <div>2</div>
                                                                <div>3</div>
                                                                <div>4</div>
                                                                <div>5</div>
                                                                <div>6</div>
                                                                <div>7</div>
                                                                <div>8</div>
                                                                <div>9</div>
                                                                <div>0</div>
                                                            </div>
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                            <span class="text-lg">/month </span></div>
                                        <div class="relative h-12  w-[280px]">
                                            <div
                                                class="flex cursor-pointer h-full relative overflow-hidden items-center justify-between rounded-full bg-gray-300 dark:bg-gray-700 px-3 w-full grow ring-2 ring-gray-400 dark:ring-gray-600">
                                                <span
                                                    style={{
                                                        right: `${100 - ((priceValue.value - 1) * 25)}%`
                                                    }}
                                                    class="rounded-l-full absolute h-full bg-gray-400 dark:bg-gray-600 left-0 pointer-events-none transition-all" />
                                                <div class="w-full h-full items-center flex justify-between rounded-full left-0 right-0 overflow-hidden relative px-3 pointer-events-none">
                                                    {new Array(5).fill(0).map((_, key) => (
                                                        <div key={`tab-${key}`} class={cn("size-6 relative z-10 rounded-full", priceValue.value >= key + 1 ? "bg-gray-500" : "bg-gray-400 dark:bg-gray-600")} />
                                                    ))}
                                                </div>
                                            </div>
                                            <div
                                                style={{
                                                    left: convertToCss(priceValue.value),
                                                }}
                                                class="absolute transition-all duration-200 pointer-events-none w-full -top-1 z-20 right-0 left-[--left] ">
                                                <span class="left-0 border-[0.625rem] border-gray-600 dark:border-gray-400 shadow-sm shadow-gray-500 size-14 block z-20 bg-gray-400 dark:bg-gray-600 rounded-full -translate-x-1/2" />
                                            </div>
                                            <audio ref={v => audio.value = v} src={audioUrl} autoplay={false} class="hidden" />
                                            <input
                                                type="range" id="snap" min={1} max={5} step={1}
                                                //@ts-expect-error
                                                onClick$={async (v) => { priceValue.value = Number(v.target?.value) as number; await audio.value?.play() }}
                                                //@ts-expect-error
                                                onChange$={(v) => { priceValue.value = Number(v.target?.value) as number; }}
                                                class="overflow-hidden absolute cursor-pointer z-30 top-0 left-0 opacity-0 h-full w-full"
                                            />
                                        </div>
                                        <div class="flex justify-center items-center w-full h-[72px] mt-2.5">
                                            <p class="font-title text-lg font-bold text-center h-max">{convertToTitle(priceValue.value)}</p>
                                        </div>
                                    </div>
                                    <hr class="h-[2px] bg-gray-400 dark:bg-gray-600" />
                                    <div class="w-full sm:text-sm text-base relative gap-3 flex flex-col">
                                        {/* <div class="flex item-center flex-col gap-2 w-full">
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24"><path fill="currentColor" d="M8.21 17.32L7 16.8a2.13 2.13 0 1 0 1.17-2.93l1.28.53a1.58 1.58 0 0 1-1.22 2.92z" /><path fill="currentColor" d="M12 2a10 10 0 0 0-10 9.34l5.38 2.21a2.31 2.31 0 0 1 .47-.24A2.62 2.62 0 0 1 9 13.1l2.44-3.56a3.8 3.8 0 1 1 3.8 3.8h-.08l-3.51 2.5a2.77 2.77 0 0 1-5.47.68l-3.77-1.6A10 10 0 1 0 12 2" /><path fill="currentColor" d="M17.79 9.5a2.53 2.53 0 1 0-2.53 2.5a2.54 2.54 0 0 0 2.53-2.5m-4.42 0a1.9 1.9 0 1 1 1.9 1.91a1.9 1.9 0 0 1-1.9-1.92z" /></svg>
                                                </div>
                                                <p>Add upto&nbsp;<span class="">7 games</span></p>
                                                <div class="py-0.5 text-xs font-title rounded-full bg-gray-300 dark:bg-gray-700 px-1.5" >
                                                    <p>+$3/game</p>
                                                </div>
                                            </div>
                                        </div> */}
                                        {/* <div class="gap-2.5 flex relative items-center w-full" >
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24">
                                                        <g fill="none" stroke="currentColor" stroke-width="1.5"><path d="M7 10c0-1.414 0-2.121.44-2.56C7.878 7 8.585 7 10 7h4c1.414 0 2.121 0 2.56.44c.44.439.44 1.146.44 2.56v4c0 1.414 0 2.121-.44 2.56c-.439.44-1.146.44-2.56.44h-4c-1.414 0-2.121 0-2.56-.44C7 16.122 7 15.415 7 14z" opacity=".5" />
                                                            <path stroke-linecap="round" stroke-linejoin="round" d="M12.429 10L11 12h2l-1.429 2" />
                                                            <path d="M4 12c0-3.771 0-5.657 1.172-6.828C6.343 4 8.229 4 12 4c3.771 0 5.657 0 6.828 1.172C20 6.343 20 8.229 20 12c0 3.771 0 5.657-1.172 6.828C17.657 20 15.771 20 12 20c-3.771 0-5.657 0-6.828-1.172C4 17.657 4 15.771 4 12Z" />
                                                            <path stroke-linecap="round" d="M4 12H2m20 0h-2M4 9H2m20 0h-2M4 15H2m20 0h-2m-8 5v2m0-20v2M9 20v2M9 2v2m6 16v2m0-20v2" opacity=".5" />
                                                        </g>
                                                    </svg>
                                                </div>
                                                <p>Premium&nbsp;<span class="">consumer</span>&nbsp;GPU</p>
                                            </div>
                                        </div> */}
                                        {/* <div class="gap-2.5 flex relative items-center w-full" >
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24"><path fill="currentColor" d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2S2 6.477 2 12s4.477 10 10 10" opacity=".5" /><path fill="currentColor" fill-rule="evenodd" d="M12 7.25a.75.75 0 0 1 .75.75v3.69l2.28 2.28a.75.75 0 1 1-1.06 1.06l-2.5-2.5a.75.75 0 0 1-.22-.53V8a.75.75 0 0 1 .75-.75" clip-rule="evenodd" /></svg>
                                                </div>
                                                <p><span class="">Unlimited</span>&nbsp;daily playtime</p>
                                            </div>
                                        </div> */}
                                        <div class="gap-2.5 flex relative items-center w-full" >
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="6" r="4" /><path stroke-linecap="round" d="M18 9c1.657 0 3-1.12 3-2.5S19.657 4 18 4M6 9C4.343 9 3 7.88 3 6.5S4.343 4 6 4" opacity=".5" /><ellipse cx="12" cy="17" rx="6" ry="4" /><path stroke-linecap="round" d="M20 19c1.754-.385 3-1.359 3-2.5s-1.246-2.115-3-2.5M4 19c-1.754-.385-3-1.359-3-2.5s1.246-2.115 3-2.5" opacity=".5" /></g></svg>
                                                </div>
                                                <p>Invite upto&nbsp;<span class="">9 play buddies</span></p>
                                            </div>
                                        </div>
                                        <div class="gap-2.5 flex relative items-center w-full" >
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-full h-full">
                                                        <path fill-rule="evenodd" d="M2 10a.75.75 0 01.75-.75h12.59l-2.1-1.95a.75.75 0 111.02-1.1l3.5 3.25a.75.75 0 010 1.1l-3.5 3.25a.75.75 0 11-1.02-1.1l2.1-1.95H2.75A.75.75 0 012 10z" clip-rule="evenodd"></path>
                                                    </svg>
                                                </div>
                                                <p><span class="">Cross-play</span>&nbsp;with home server</p>
                                            </div>
                                        </div>
                                        <div class="gap-2.5 flex relative items-center w-full" >
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-full h-full">
                                                        <path fill-rule="evenodd" d="M2 10a.75.75 0 01.75-.75h12.59l-2.1-1.95a.75.75 0 111.02-1.1l3.5 3.25a.75.75 0 010 1.1l-3.5 3.25a.75.75 0 11-1.02-1.1l2.1-1.95H2.75A.75.75 0 012 10z" clip-rule="evenodd"></path>
                                                    </svg>
                                                </div>
                                                <p>Frame Rates upto&nbsp;<span class="">120 fps</span></p>
                                            </div>
                                        </div>
                                        <div class="gap-2.5 flex relative items-center w-full" >
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-full h-full">
                                                        <path fill-rule="evenodd" d="M2 10a.75.75 0 01.75-.75h12.59l-2.1-1.95a.75.75 0 111.02-1.1l3.5 3.25a.75.75 0 010 1.1l-3.5 3.25a.75.75 0 11-1.02-1.1l2.1-1.95H2.75A.75.75 0 012 10z" clip-rule="evenodd"></path>
                                                    </svg>
                                                </div>
                                                <p>Video quality upto&nbsp;<span class="">4k UHD</span></p>
                                            </div>
                                        </div>
                                        <div class="gap-2.5 flex relative items-center w-full" >
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-full h-full">
                                                        <path fill-rule="evenodd" d="M2 10a.75.75 0 01.75-.75h12.59l-2.1-1.95a.75.75 0 111.02-1.1l3.5 3.25a.75.75 0 010 1.1l-3.5 3.25a.75.75 0 11-1.02-1.1l2.1-1.95H2.75A.75.75 0 012 10z" clip-rule="evenodd"></path>
                                                    </svg>
                                                </div>
                                                <p><span class="">Unlimited</span>&nbsp;cloud saves</p>
                                            </div>
                                        </div>
                                        <div class="gap-2.5 flex relative items-center w-full" >
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-full h-full">
                                                        <path fill-rule="evenodd" d="M2 10a.75.75 0 01.75-.75h12.59l-2.1-1.95a.75.75 0 111.02-1.1l3.5 3.25a.75.75 0 010 1.1l-3.5 3.25a.75.75 0 11-1.02-1.1l2.1-1.95H2.75A.75.75 0 012 10z" clip-rule="evenodd"></path>
                                                    </svg>
                                                </div>
                                                <p>Unlimited&nbsp;<span class="">State Shares</span>&nbsp;</p>
                                            </div>
                                        </div>
                                        <div class="gap-2.5 flex relative items-center w-full" >
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-full h-full">
                                                        <path fill-rule="evenodd" d="M2 10a.75.75 0 01.75-.75h12.59l-2.1-1.95a.75.75 0 111.02-1.1l3.5 3.25a.75.75 0 010 1.1l-3.5 3.25a.75.75 0 11-1.02-1.1l2.1-1.95H2.75A.75.75 0 012 10z" clip-rule="evenodd"></path>
                                                    </svg>
                                                </div>
                                                <p><span class="">Game mod</span>&nbsp;support</p>
                                            </div>
                                        </div>
                                        <div class="gap-2.5 flex relative items-center w-full" >
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-full h-full">
                                                        <path fill-rule="evenodd" d="M2 10a.75.75 0 01.75-.75h12.59l-2.1-1.95a.75.75 0 111.02-1.1l3.5 3.25a.75.75 0 010 1.1l-3.5 3.25a.75.75 0 11-1.02-1.1l2.1-1.95H2.75A.75.75 0 012 10z" clip-rule="evenodd"></path>
                                                    </svg>
                                                </div>
                                                <p><span class="">Stream</span>&nbsp;to Youtube/Twitch</p>
                                            </div>
                                        </div>
                                    </div>
                                    <button class="my-4 focus:ring-primary-500 hover:ring-primary-500 ring-gray-500 rounded-lg outline-none dark:text-gray-100/70 ring-2 text-sm h-max py-2 px-4 flex items-center transition-all duration-200 focus:bg-primary-100 focus:dark:bg-primary-900 bg-gray-300/70 dark:bg-gray-700/30 focus:text-primary-500 text-gray-500 font-title font-bold justify-between">
                                        Start Playing with Family Now
                                        <div class="size-5 relative">
                                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-full h-full">
                                                <path fill-rule="evenodd" d="M2 10a.75.75 0 01.75-.75h12.59l-2.1-1.95a.75.75 0 111.02-1.1l3.5 3.25a.75.75 0 010 1.1l-3.5 3.25a.75.75 0 11-1.02-1.1l2.1-1.95H2.75A.75.75 0 012 10z" clip-rule="evenodd"></path>
                                            </svg>
                                        </div>
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div class="bg-gray-200/70 dark:bg-gray-800/70 ring-2 ring-gray-300 dark:ring-gray-700 rounded-xl w-full overflow-hidden" >
                            <div class="flex gap-3 relative w-full flex-col px-6 pt-6" >
                                <div class="w-full flex items-center gap-2" >
                                    <div class="rounded-full size-4 overflow-hidden bg-gradient-to-tr from-[#a0f906] to-[#e60d0d]" />
                                    <p class="text-base font-medium">Enterprise</p>
                                </div>
                                <p class="text-neutral-900/70 dark:text-neutral-100/70 text-base" >
                                    Looking for something else? Use Nestri as your own on our servers or yours. Flexible licensing and white-glove onboarding included.
                                </p>
                                <button class="underline underline-offset-2 font-medium font-title hover:opacity-70 w-max">
                                    Contact Sales
                                </button>
                            </div>
                            <div class="w-full text-gray-900/70 bg-gray-400/30 dark:bg-gray-600/30 dark:text-gray-100/30 whitespace-nowrap font-mono text-sm mt-6 py-3">
                                <div class="flex relative">
                                    <span class="whitespace-pre marquee-animation">
                                        Organization Account · Security Restrictions · Custom Events · Single Sign On · Advanced Integrations · Additional APIs · Custom-Built Features ·
                                        Organization Account · Security Restrictions · Custom Events · Single Sign On · Advanced Integrations · Additional APIs · Custom-Built Features ·
                                    </span>
                                </div>
                            </div>
                        </div>
                    </section>
                </div>
            </MotionComponent>
            <Footer />
        </>
    )
})