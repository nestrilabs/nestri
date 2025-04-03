import { Howl } from 'howler';
import { cn } from "@nestri/ui/design";
import { Link, routeLoader$ } from "@builder.io/qwik-city";
import { Footer, Book, CONSTANTS } from "@nestri/ui"
import { TitleSection, MotionComponent, transition } from "@nestri/ui/react";
import { $, component$, noSerialize, type NoSerialize, useSignal, useVisibleTask$ } from "@builder.io/qwik";
// import { createClient } from '@openauthjs/openauth/client';

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
            return [1, 5]
        case 2:
            return [2, 0]
        case 3:
            return [2, 5]
        case 4:
            return [3, 5]
        case 5:
            return [5, 0]
        default:
            return [2, 5];
    }
}

const convertToTitle = (value: any) => {
    switch (value) {
        case 1:
            return "No sweat. Pay what you can\n and enjoy Nestri"
        case 2:
            return "You've got a deal"
        case 3:
            return "Choose what feels right"
        case 4:
            return "Our hero. We see you!\n We thank you"
        case 5:
            return "Omg! You have no idea\n how much your support\n means to us"
        default:
            return "Choose what feels right";
    }
}

// export const useLink = routeLoader$(async (ev) => {

//     const client = createClient({
//         clientID: "www",
//         issuer: "https://auth.nestri.io"
//     })

//     const { url } = await client.authorize(ev.url.origin + "/callback", "code")

//     return url
// })
export const useLink = routeLoader$(async ({ sharedMap }) => {
    const url = sharedMap.get("auth_url") as string

    return url
})

export default component$(() => {
    const loginUrl = useLink() // { value: "/" }//

    const priceValue = useSignal(3)
    const docsLinkRef = useSignal<HTMLElement | undefined>()
    const bookRef = useSignal<HTMLElement | undefined>()
    const audio = useSignal<NoSerialize<Howl> | undefined>()

    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(() => {
        audio.value = noSerialize(new Howl({ src: ["/audio/click.wav"] }))

        docsLinkRef.value?.addEventListener("mouseenter", () => {
            bookRef.value?.classList.add('flip')
        })
        docsLinkRef.value?.addEventListener("mouseleave", () => {
            bookRef.value?.classList.remove('flip')
        })
        return () => {
            docsLinkRef.value?.removeEventListener("mouseenter", () => {
                bookRef.value?.classList.add('flip')
            })
            docsLinkRef.value?.removeEventListener("mouseleave", () => {
                bookRef.value?.classList.remove('flip')
            })
        }
    })

    const onClick = $((v: any) => {
        priceValue.value = Number(v.target?.value) as number;
        audio.value?.play()
    })

    return (
        <div class="w-screen relative">
            <TitleSection client:load title="Pricing" description={"We're growing at the speed of trust. Choose a price that feels right for you and help support Nestri"} />
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
                                            Perfect for casual gamers and those new to Nestri. Dive into self-hosted gaming without spending a dime.
                                        </p>
                                    </div>
                                    <div class="flex flex-col w-full">
                                        <p class="text-[4rem] leading-[1] font-medium font-title"> Free </p>
                                        {/**FIXME: Add the link to the docs here */}
                                        <a href={CONSTANTS.githubLink} ref={v => bookRef.value = v} class="h-[154px] w-full flex items-start pt-4 justify-center overflow-hidden">
                                            <Book textColor="#FFF"
                                                bgColor="#FF4F01"
                                                title="Getting started with Nestri" class="shadow-lg shadow-gray-900 dark:shadow-gray-300" />
                                        </a>
                                        <hr class="h-[2px] bg-gray-400 text-gray-300 dark:bg-gray-600 " />
                                    </div>
                                    <div class="w-full relative sm:text-sm text-base gap-3 flex flex-col">
                                        <div class="gap-2.5 flex relative items-center w-full" >
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="6" r="4" /><path stroke-linecap="round" d="M18 9c1.657 0 3-1.12 3-2.5S19.657 4 18 4M6 9C4.343 9 3 7.88 3 6.5S4.343 4 6 4" opacity=".5" /><ellipse cx="12" cy="17" rx="6" ry="4" /><path stroke-linecap="round" d="M20 19c1.754-.385 3-1.359 3-2.5s-1.246-2.115-3-2.5M4 19c-1.754-.385-3-1.359-3-2.5s1.246-2.115 3-2.5" opacity=".5" /></g></svg>
                                                </div>
                                                <p>Single user</p>
                                            </div>
                                        </div>
                                        <div class="gap-2.5 flex relative items-center w-full" >
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" color="currentColor"><path d="m4.5 21.5l4-4m2 0l4 4m-5-4v5M2 11.875c0-2.062 0-3.094 1.025-3.734S5.7 7.5 9 7.5h1c3.3 0 4.95 0 5.975.64C17 8.782 17 9.814 17 11.876v1.25c0 2.062 0 3.094-1.025 3.734S13.3 17.5 10 17.5H9c-3.3 0-4.95 0-5.975-.64C2 16.218 2 15.186 2 13.124zm15-1.625l.126-.076c2.116-1.27 3.174-1.904 4.024-1.598c.85.307.85 1.323.85 3.355v1.138c0 2.032 0 3.048-.85 3.355s-1.908-.329-4.024-1.598L17 14.75" /><circle cx="12.5" cy="5" r="2.5" /><circle cx="7" cy="4.5" r="3" /></g></svg>
                                                </div>
                                                <p>1080p video stream</p>
                                            </div>
                                        </div>
                                        <div class="gap-2.5 flex relative items-center w-full" >
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24"><path fill="currentColor" d="M11.75 19h-.25q-3.55 0-6.025-2.475T3 10.5t2.475-6.025T11.5 2q1.775 0 3.313.662t2.7 1.825t1.824 2.7T20 10.5q0 3.35-1.888 6.225t-4.762 4.5q-.25.125-.5.138t-.45-.113t-.35-.325t-.175-.475zm2.25-.65q1.775-1.5 2.888-3.512T18 10.5q0-2.725-1.888-4.612T11.5 4T6.888 5.888T5 10.5t1.888 4.613T11.5 17H14zm-2.525-2.375q.425 0 .725-.3t.3-.725t-.3-.725t-.725-.3t-.725.3t-.3.725t.3.725t.725.3M9.3 8.375q.275.125.55.013t.45-.363q.225-.3.525-.463T11.5 7.4q.6 0 .975.337t.375.863q0 .325-.187.65t-.663.8q-.625.55-.925 1.038t-.3.987q0 .3.213.513t.512.212t.5-.225t.3-.525q.125-.425.45-.775t.6-.625q.525-.525.788-1.05t.262-1.05q0-1.15-.788-1.85T11.5 6q-.8 0-1.475.388t-1.1 1.062q-.15.275-.038.538t.413.387m2.2 2.8" /></svg>
                                                </div>
                                                <p>Community support</p>
                                            </div>
                                        </div>
                                        <div class="gap-2.5 flex relative items-center w-full" >
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.5"><path d="M7 10c0-1.414 0-2.121.44-2.56C7.878 7 8.585 7 10 7h4c1.414 0 2.121 0 2.56.44c.44.439.44 1.146.44 2.56v4c0 1.414 0 2.121-.44 2.56c-.439.44-1.146.44-2.56.44h-4c-1.414 0-2.121 0-2.56-.44C7 16.122 7 15.415 7 14z" /><path stroke-linecap="round" stroke-linejoin="round" d="M12.429 10L11 12h2l-1.429 2" /><path d="M4 12c0-3.771 0-5.657 1.172-6.828S8.229 4 12 4s5.657 0 6.828 1.172S20 8.229 20 12s0 5.657-1.172 6.828S15.771 20 12 20s-5.657 0-6.828-1.172S4 15.771 4 12Z" /><path stroke-linecap="round" d="M4 12H2m20 0h-2M4 9H2m20 0h-2M4 15H2m20 0h-2m-8 5v2m0-20v2M9 20v2M9 2v2m6 16v2m0-20v2" /></g></svg>
                                                </div>
                                                <p>Install on a single rig</p>
                                            </div>
                                        </div>
                                        <div class="gap-2.5 flex relative items-center w-full" >
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M20.972 11.291a9 9 0 1 0-8.322 9.686M3.6 9h16.8M3.6 15h8.9" /><path d="M11.5 3a17 17 0 0 0 0 18m1-18a17 17 0 0 1 2.578 9.018m6.043 8.103a3 3 0 1 0-4.242 0Q17.506 20.749 19 22q1.577-1.335 2.121-1.879M19 18v.01" /></g></svg>                                                </div>
                                                <p>Shared single region relay</p>
                                            </div>
                                        </div>
                                        <div class="gap-2.5 flex relative items-center w-full" >
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 6c0-1.886 0-2.828.586-3.414S4.114 2 6 2h5c1.886 0 2.828 0 3.414.586S15 4.114 15 6s0 2.828-.586 3.414S12.886 10 11 10H6c-1.886 0-2.828 0-3.414-.586S2 7.886 2 6Zm8 12c0-1.886 0-2.828.586-3.414S12.114 14 14 14h3c1.886 0 2.828 0 3.414.586S21 16.114 21 18s0 2.828-.586 3.414S18.886 22 17 22h-3c-1.886 0-2.828 0-3.414-.586S10 19.886 10 18Z" /><path stroke-linecap="round" d="M6 2.5V10m7.5 4.5V22M11 2.5V10m6.5 4.5V22M2.5 6H6m9 0h-4m0 12h2.5m7.5 0h-3.5" /><path stroke-linecap="round" stroke-linejoin="round" d="M21 11v-1c0-.932 0-2.398-.152-2.765a2 2 0 0 0-1.083-1.083C19.398 6 18.932 6 18 6m3 5l1-1m-1 1l-1-1M3 13v1c0 .932 0 2.398.152 2.765a2 2 0 0 0 1.083 1.083C4.602 18 5.068 18 6 18m-3-5l-1 1m1-1l1 1" /></g></svg>
                                                </div>
                                                <p>50GB bandwidth limit per month <sup>2</sup></p>
                                            </div>
                                        </div>
                                        <div class="gap-2.5 flex relative items-center w-full" >
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 14 14"><g fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M2.179 6.011L4.114.881l3.653 1.04l-1.062 5.38a2.362 2.362 0 1 1-4.526-1.29m1.563 3.104l-1.074 3.766m-1.484-.424l2.967.846" /><path d="m3.148 3.438l4.086 1.175" /><path stroke-linecap="round" stroke-linejoin="round" d="M8.567 8.963a2.362 2.362 0 0 0 3.255-2.952L9.885.881l-.576.163m.949 8.071l1.074 3.766m1.484-.424l-2.967.846m1.003-9.853l-1.669.48" /></g></svg>
                                                </div>
                                                <p>Public parties only</p>
                                            </div>
                                        </div>
                                        <div class="gap-2.5 flex relative items-center w-full" >
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5" d="m17 7.83l1.697 1.526c1.542 1.389 2.313 2.083 2.313 2.974c0 .89-.771 1.585-2.314 2.973L17 16.83M13.987 5L12 12.415l-1.987 7.415M7 7.83L5.304 9.356C3.76 10.745 2.99 11.44 2.99 12.33s.771 1.585 2.314 2.973L7 16.83" /></svg>
                                                </div>
                                                <p>Limited API access </p>
                                            </div>
                                        </div>

                                        <div class="gap-2.5 flex relative items-center w-full" >
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24"><path fill="currentColor" d="M14.5 11.75q-.525 0-.888-.363t-.362-.887t.363-.888t.887-.362t.888.363t.362.887t-.363.888t-.887.362m-5 0q-.525 0-.888-.363T8.25 10.5t.363-.888t.887-.362t.888.363t.362.887t-.363.888t-.887.362M12 17q-1.5 0-2.713-.825T7.5 14h9q-.575 1.35-1.787 2.175T12 17m0 4q-1.875 0-3.512-.712t-2.85-1.925t-1.925-2.85T3 12t.713-3.512t1.924-2.85t2.85-1.925T12 3t3.513.713t2.85 1.924t1.925 2.85T21 12t-.712 3.513t-1.925 2.85t-2.85 1.925T12 21m0-2q2.9 0 4.95-2.05T19 12t-2.05-4.95T12 5h-.3q-.15 0-.3.05q-.15.15-.2.325t-.05.375q0 .525.362.888T12.4 7q.225 0 .413-.075t.387-.075q.3 0 .5.225t.2.525q0 .575-.538.738T12.4 8.5q-1.125 0-1.937-.812T9.65 5.75V5.6q0-.075.025-.2Q7.6 6.15 6.3 7.925T5 12q0 2.9 2.05 4.95T12 19m0-7" /></svg>
                                                </div>
                                                <p>No parental controls <sup>1</sup></p>
                                            </div>
                                        </div>
                                        <div class="gap-2.5 flex relative items-center w-full" >
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="m16.574 19.2l-3.938-3.938l-1.203 1.202c-1.23 1.232-1.846 1.847-2.508 1.702s-.963-.963-1.565-2.596l-2.007-5.45C4.152 6.861 3.55 5.232 4.39 4.392s2.47-.24 5.73.962l5.45 2.006c1.633.602 2.45.903 2.596 1.565s-.47 1.277-1.702 2.508l-1.202 1.203l3.938 3.938c.408.408.612.612.706.84c.125.303.125.643 0 .947c-.094.227-.298.431-.706.839s-.612.612-.84.706a1.24 1.24 0 0 1-.947 0c-.227-.094-.43-.298-.839-.706" /></svg>
                                                </div>
                                                <p>Basic analytics <sup>1</sup></p>
                                            </div>
                                        </div>
                                        <div class="gap-2.5 flex relative items-center w-full" >
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-full h-full">
                                                        <path fill-rule="evenodd" d="M2 10a.75.75 0 01.75-.75h12.59l-2.1-1.95a.75.75 0 111.02-1.1l3.5 3.25a.75.75 0 010 1.1l-3.5 3.25a.75.75 0 11-1.02-1.1l2.1-1.95H2.75A.75.75 0 012 10z" clip-rule="evenodd"></path>
                                                    </svg>
                                                </div>
                                                <p>Unlimited cloud saves <sup>1</sup></p>
                                            </div>
                                        </div>
                                        <div class="gap-2.5 flex relative items-center w-full" >
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-full h-full">
                                                        <path fill-rule="evenodd" d="M2 10a.75.75 0 01.75-.75h12.59l-2.1-1.95a.75.75 0 111.02-1.1l3.5 3.25a.75.75 0 010 1.1l-3.5 3.25a.75.75 0 11-1.02-1.1l2.1-1.95H2.75A.75.75 0 012 10z" clip-rule="evenodd"></path>
                                                    </svg>
                                                </div>
                                                <p>Unlimited state shares <sup>1</sup></p>
                                            </div>
                                        </div>
                                        <div class="gap-2.5 flex relative items-center w-full" >
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-full h-full">
                                                        <path fill-rule="evenodd" d="M2 10a.75.75 0 01.75-.75h12.59l-2.1-1.95a.75.75 0 111.02-1.1l3.5 3.25a.75.75 0 010 1.1l-3.5 3.25a.75.75 0 11-1.02-1.1l2.1-1.95H2.75A.75.75 0 012 10z" clip-rule="evenodd"></path>
                                                    </svg>
                                                </div>
                                                <p>Game mod support <sup>1</sup></p>
                                            </div>
                                        </div>
                                        <div class="gap-2.5 flex relative items-center w-full" >
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-full h-full">
                                                        <path fill-rule="evenodd" d="M2 10a.75.75 0 01.75-.75h12.59l-2.1-1.95a.75.75 0 111.02-1.1l3.5 3.25a.75.75 0 010 1.1l-3.5 3.25a.75.75 0 11-1.02-1.1l2.1-1.95H2.75A.75.75 0 012 10z" clip-rule="evenodd"></path>
                                                    </svg>
                                                </div>
                                                <p>Stream to Youtube/Twitch <sup>1</sup></p>
                                            </div>
                                        </div>
                                    </div>
                                    <a href={CONSTANTS.githubLink} ref={v => docsLinkRef.value = v} class="my-4 bg-white dark:bg-black focus:ring-primary-500 hover:ring-primary-500 ring-gray-500 rounded-lg outline-none dark:text-gray-100/70 ring-2 text-sm h-max py-2 px-4 flex items-center transition-all duration-200 focus:bg-primary-100 focus:dark:bg-primary-900 focus:text-primary-500 text-gray-500 font-title font-bold justify-between">
                                        Read the Docs
                                        <div class="size-5 relative">
                                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-full h-full">
                                                <path fill-rule="evenodd" d="M2 10a.75.75 0 01.75-.75h12.59l-2.1-1.95a.75.75 0 111.02-1.1l3.5 3.25a.75.75 0 010 1.1l-3.5 3.25a.75.75 0 11-1.02-1.1l2.1-1.95H2.75A.75.75 0 012 10z" clip-rule="evenodd"></path>
                                            </svg>
                                        </div>
                                    </a>
                                </div>
                                <div class="gap-3 w-full p-6 flex flex-col rounded-lg bg-white dark:bg-black">
                                    <div class="flex items-center font-title h-min w-full justify-between">
                                        <div class="flex items-center justify-center gap-2 ">
                                            <div class="bg-gradient-to-t from-[#685fea] to-[rgb(153,148,224)] rounded-full h-4 w-4" />
                                            <h1 class="text-base font-semibold">Pro</h1>
                                        </div>
                                    </div>
                                    <div class="break-words [word-break:break-word] [text-wrap:balance] [word-wrap:break-word] w-full relative whitespace-pre-wrap">
                                        <p class="text-base text-gray-950/70 dark:text-gray-50/70">
                                            Ideal for dedicated gamers who crave more flexibility and social gaming experiences.
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
                                            <input
                                                type="range" id="snap" min={1} max={5} step={1}
                                                onClick$={onClick}
                                                class="overflow-hidden absolute cursor-pointer z-30 top-0 left-0 opacity-0 h-full w-full"
                                            />
                                        </div>
                                        <div class="flex justify-center items-center w-full h-[72px] mt-2.5 text-primary-500">
                                            <p class="font-title text-lg font-bold text-center h-max break-words whitespace-pre-line">{convertToTitle(priceValue.value)}</p>
                                        </div>
                                    </div>
                                    <hr class="h-[2px] bg-gray-400 dark:bg-gray-600" />
                                    <div class="w-full sm:text-sm text-base relative gap-3 flex flex-col">
                                        <div class="gap-2.5 flex relative items-center w-full" >
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="6" r="4" /><path stroke-linecap="round" d="M18 9c1.657 0 3-1.12 3-2.5S19.657 4 18 4M6 9C4.343 9 3 7.88 3 6.5S4.343 4 6 4" opacity=".5" /><ellipse cx="12" cy="17" rx="6" ry="4" /><path stroke-linecap="round" d="M20 19c1.754-.385 3-1.359 3-2.5s-1.246-2.115-3-2.5M4 19c-1.754-.385-3-1.359-3-2.5s1.246-2.115 3-2.5" opacity=".5" /></g></svg>
                                                </div>
                                                <p>Upto 5 users</p>
                                            </div>
                                        </div>
                                        <div class="gap-2.5 flex relative items-center w-full" >
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" color="currentColor"><path d="m4.5 21.5l4-4m2 0l4 4m-5-4v5M2 11.875c0-2.062 0-3.094 1.025-3.734S5.7 7.5 9 7.5h1c3.3 0 4.95 0 5.975.64C17 8.782 17 9.814 17 11.876v1.25c0 2.062 0 3.094-1.025 3.734S13.3 17.5 10 17.5H9c-3.3 0-4.95 0-5.975-.64C2 16.218 2 15.186 2 13.124zm15-1.625l.126-.076c2.116-1.27 3.174-1.904 4.024-1.598c.85.307.85 1.323.85 3.355v1.138c0 2.032 0 3.048-.85 3.355s-1.908-.329-4.024-1.598L17 14.75" /><circle cx="12.5" cy="5" r="2.5" /><circle cx="7" cy="4.5" r="3" /></g></svg>
                                                </div>
                                                <p>4k video stream <sup>1</sup></p>
                                            </div>
                                        </div>
                                        <div class="gap-2.5 flex relative items-center w-full" >
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24"><path fill="currentColor" d="M11.75 19h-.25q-3.55 0-6.025-2.475T3 10.5t2.475-6.025T11.5 2q1.775 0 3.313.662t2.7 1.825t1.824 2.7T20 10.5q0 3.35-1.888 6.225t-4.762 4.5q-.25.125-.5.138t-.45-.113t-.35-.325t-.175-.475zm2.25-.65q1.775-1.5 2.888-3.512T18 10.5q0-2.725-1.888-4.612T11.5 4T6.888 5.888T5 10.5t1.888 4.613T11.5 17H14zm-2.525-2.375q.425 0 .725-.3t.3-.725t-.3-.725t-.725-.3t-.725.3t-.3.725t.3.725t.725.3M9.3 8.375q.275.125.55.013t.45-.363q.225-.3.525-.463T11.5 7.4q.6 0 .975.337t.375.863q0 .325-.187.65t-.663.8q-.625.55-.925 1.038t-.3.987q0 .3.213.513t.512.212t.5-.225t.3-.525q.125-.425.45-.775t.6-.625q.525-.525.788-1.05t.262-1.05q0-1.15-.788-1.85T11.5 6q-.8 0-1.475.388t-1.1 1.062q-.15.275-.038.538t.413.387m2.2 2.8" /></svg>
                                                </div>
                                                <p>Priority support</p>
                                            </div>
                                        </div>
                                        <div class="gap-2.5 flex relative items-center w-full" >
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.5"><path d="M7 10c0-1.414 0-2.121.44-2.56C7.878 7 8.585 7 10 7h4c1.414 0 2.121 0 2.56.44c.44.439.44 1.146.44 2.56v4c0 1.414 0 2.121-.44 2.56c-.439.44-1.146.44-2.56.44h-4c-1.414 0-2.121 0-2.56-.44C7 16.122 7 15.415 7 14z" /><path stroke-linecap="round" stroke-linejoin="round" d="M12.429 10L11 12h2l-1.429 2" /><path d="M4 12c0-3.771 0-5.657 1.172-6.828S8.229 4 12 4s5.657 0 6.828 1.172S20 8.229 20 12s0 5.657-1.172 6.828S15.771 20 12 20s-5.657 0-6.828-1.172S4 15.771 4 12Z" /><path stroke-linecap="round" d="M4 12H2m20 0h-2M4 9H2m20 0h-2M4 15H2m20 0h-2m-8 5v2m0-20v2M9 20v2M9 2v2m6 16v2m0-20v2" /></g></svg>
                                                </div>
                                                <p>Install on multiple rigs </p>
                                            </div>
                                        </div>
                                        <div class="gap-2.5 flex relative items-center w-full" >
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M20.972 11.291a9 9 0 1 0-8.322 9.686M3.6 9h16.8M3.6 15h8.9" /><path d="M11.5 3a17 17 0 0 0 0 18m1-18a17 17 0 0 1 2.578 9.018m6.043 8.103a3 3 0 1 0-4.242 0Q17.506 20.749 19 22q1.577-1.335 2.121-1.879M19 18v.01" /></g></svg>                                                </div>
                                                <p>Dedicated multi-region relays</p>
                                            </div>
                                        </div>
                                        <div class="gap-2.5 flex relative items-center w-full" >
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 6c0-1.886 0-2.828.586-3.414S4.114 2 6 2h5c1.886 0 2.828 0 3.414.586S15 4.114 15 6s0 2.828-.586 3.414S12.886 10 11 10H6c-1.886 0-2.828 0-3.414-.586S2 7.886 2 6Zm8 12c0-1.886 0-2.828.586-3.414S12.114 14 14 14h3c1.886 0 2.828 0 3.414.586S21 16.114 21 18s0 2.828-.586 3.414S18.886 22 17 22h-3c-1.886 0-2.828 0-3.414-.586S10 19.886 10 18Z" /><path stroke-linecap="round" d="M6 2.5V10m7.5 4.5V22M11 2.5V10m6.5 4.5V22M2.5 6H6m9 0h-4m0 12h2.5m7.5 0h-3.5" /><path stroke-linecap="round" stroke-linejoin="round" d="M21 11v-1c0-.932 0-2.398-.152-2.765a2 2 0 0 0-1.083-1.083C19.398 6 18.932 6 18 6m3 5l1-1m-1 1l-1-1M3 13v1c0 .932 0 2.398.152 2.765a2 2 0 0 0 1.083 1.083C4.602 18 5.068 18 6 18m-3-5l-1 1m1-1l1 1" /></g></svg>
                                                </div>
                                                <p>Unlimited bandwidth</p>
                                            </div>
                                        </div>
                                        <div class="gap-2.5 flex relative items-center w-full" >
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 14 14"><g fill="none" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M2.179 6.011L4.114.881l3.653 1.04l-1.062 5.38a2.362 2.362 0 1 1-4.526-1.29m1.563 3.104l-1.074 3.766m-1.484-.424l2.967.846" /><path d="m3.148 3.438l4.086 1.175" /><path stroke-linecap="round" stroke-linejoin="round" d="M8.567 8.963a2.362 2.362 0 0 0 3.255-2.952L9.885.881l-.576.163m.949 8.071l1.074 3.766m1.484-.424l-2.967.846m1.003-9.853l-1.669.48" /></g></svg>
                                                </div>
                                                <p>Public & private parties <sup>1</sup></p>
                                            </div>
                                        </div>
                                        <div class="gap-2.5 flex relative items-center w-full" >
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5" d="m17 7.83l1.697 1.526c1.542 1.389 2.313 2.083 2.313 2.974c0 .89-.771 1.585-2.314 2.973L17 16.83M13.987 5L12 12.415l-1.987 7.415M7 7.83L5.304 9.356C3.76 10.745 2.99 11.44 2.99 12.33s.771 1.585 2.314 2.973L7 16.83" /></svg>
                                                </div>
                                                <p>API access </p>
                                            </div>
                                        </div>
                                        <div class="gap-2.5 flex relative items-center w-full" >
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24"><path fill="currentColor" d="M14.5 11.75q-.525 0-.888-.363t-.362-.887t.363-.888t.887-.362t.888.363t.362.887t-.363.888t-.887.362m-5 0q-.525 0-.888-.363T8.25 10.5t.363-.888t.887-.362t.888.363t.362.887t-.363.888t-.887.362M12 17q-1.5 0-2.713-.825T7.5 14h9q-.575 1.35-1.787 2.175T12 17m0 4q-1.875 0-3.512-.712t-2.85-1.925t-1.925-2.85T3 12t.713-3.512t1.924-2.85t2.85-1.925T12 3t3.513.713t2.85 1.924t1.925 2.85T21 12t-.712 3.513t-1.925 2.85t-2.85 1.925T12 21m0-2q2.9 0 4.95-2.05T19 12t-2.05-4.95T12 5h-.3q-.15 0-.3.05q-.15.15-.2.325t-.05.375q0 .525.362.888T12.4 7q.225 0 .413-.075t.387-.075q.3 0 .5.225t.2.525q0 .575-.538.738T12.4 8.5q-1.125 0-1.937-.812T9.65 5.75V5.6q0-.075.025-.2Q7.6 6.15 6.3 7.925T5 12q0 2.9 2.05 4.95T12 19m0-7" /></svg>
                                                </div>
                                                <p>Parental controls <sup>1</sup></p>
                                            </div>
                                        </div>
                                        <div class="gap-2.5 flex relative items-center w-full" >
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="m16.574 19.2l-3.938-3.938l-1.203 1.202c-1.23 1.232-1.846 1.847-2.508 1.702s-.963-.963-1.565-2.596l-2.007-5.45C4.152 6.861 3.55 5.232 4.39 4.392s2.47-.24 5.73.962l5.45 2.006c1.633.602 2.45.903 2.596 1.565s-.47 1.277-1.702 2.508l-1.202 1.203l3.938 3.938c.408.408.612.612.706.84c.125.303.125.643 0 .947c-.094.227-.298.431-.706.839s-.612.612-.84.706a1.24 1.24 0 0 1-.947 0c-.227-.094-.43-.298-.839-.706" /></svg>
                                                </div>
                                                <p>Advanced analytics <sup>1</sup></p>
                                            </div>
                                        </div>
                                        <div class="gap-2.5 flex relative items-center w-full" >
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-full h-full">
                                                        <path fill-rule="evenodd" d="M2 10a.75.75 0 01.75-.75h12.59l-2.1-1.95a.75.75 0 111.02-1.1l3.5 3.25a.75.75 0 010 1.1l-3.5 3.25a.75.75 0 11-1.02-1.1l2.1-1.95H2.75A.75.75 0 012 10z" clip-rule="evenodd"></path>
                                                    </svg>
                                                </div>
                                                <p>Unlimited cloud saves <sup>1</sup></p>
                                            </div>
                                        </div>
                                        <div class="gap-2.5 flex relative items-center w-full" >
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-full h-full">
                                                        <path fill-rule="evenodd" d="M2 10a.75.75 0 01.75-.75h12.59l-2.1-1.95a.75.75 0 111.02-1.1l3.5 3.25a.75.75 0 010 1.1l-3.5 3.25a.75.75 0 11-1.02-1.1l2.1-1.95H2.75A.75.75 0 012 10z" clip-rule="evenodd"></path>
                                                    </svg>
                                                </div>
                                                <p>Unlimited state shares <sup>1</sup></p>
                                            </div>
                                        </div>
                                        <div class="gap-2.5 flex relative items-center w-full" >
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-full h-full">
                                                        <path fill-rule="evenodd" d="M2 10a.75.75 0 01.75-.75h12.59l-2.1-1.95a.75.75 0 111.02-1.1l3.5 3.25a.75.75 0 010 1.1l-3.5 3.25a.75.75 0 11-1.02-1.1l2.1-1.95H2.75A.75.75 0 012 10z" clip-rule="evenodd"></path>
                                                    </svg>
                                                </div>
                                                <p>Game mod support <sup>1</sup></p>
                                            </div>
                                        </div>
                                        <div class="gap-2.5 flex relative items-center w-full" >
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-full h-full">
                                                        <path fill-rule="evenodd" d="M2 10a.75.75 0 01.75-.75h12.59l-2.1-1.95a.75.75 0 111.02-1.1l3.5 3.25a.75.75 0 010 1.1l-3.5 3.25a.75.75 0 11-1.02-1.1l2.1-1.95H2.75A.75.75 0 012 10z" clip-rule="evenodd"></path>
                                                    </svg>
                                                </div>
                                                <p>Stream to Youtube/Twitch <sup>1</sup></p>
                                            </div>
                                        </div>
                                    </div>
                                    <a href={loginUrl.value} class="my-4 focus:ring-primary-500 hover:ring-primary-500 ring-gray-500 rounded-lg outline-none dark:text-gray-100/70 ring-2 text-sm h-max py-2 px-4 flex items-center transition-all duration-200 focus:bg-primary-100 focus:dark:bg-primary-900 bg-gray-300/70 dark:bg-gray-700/30 focus:text-primary-500 text-gray-500 font-title font-bold justify-between">
                                        Get Nestri Pro
                                        <div class="size-5 relative">
                                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-full h-full">
                                                <path fill-rule="evenodd" d="M2 10a.75.75 0 01.75-.75h12.59l-2.1-1.95a.75.75 0 111.02-1.1l3.5 3.25a.75.75 0 010 1.1l-3.5 3.25a.75.75 0 11-1.02-1.1l2.1-1.95H2.75A.75.75 0 012 10z" clip-rule="evenodd"></path>
                                            </svg>
                                        </div>
                                    </a>
                                    <div class="flex flex-col gap-0.5">
                                        <div class="text-neutral-900/70 dark:text-neutral-100/70 text-xs">
                                            <sup>1</sup> Feature is in development
                                        </div>
                                        <div class="text-neutral-900/70 dark:text-neutral-100/70 text-xs">
                                            <sup>2</sup> Approximately 33 hours of 1080p streaming
                                        </div>
                                    </div>
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
                                <Link href={CONSTANTS.enterpriseContact} class="underline underline-offset-2 font-medium font-title hover:opacity-70 w-max">
                                    Contact Sales
                                </Link>
                            </div>
                            <div class="w-full text-gray-900/70 bg-gray-400/30 dark:bg-gray-600/30 dark:text-gray-100/30 whitespace-nowrap font-mono text-sm mt-6 py-3">
                                <div class="flex relative">
                                    <span class="whitespace-pre marquee-animation">
                                        Organization Account · Security Restrictions · Custom Parties · Single Sign On · Advanced Integrations · Additional APIs · Custom-Built Features ·
                                        Organization Account · Security Restrictions · Custom Parties · Single Sign On · Advanced Integrations · Additional APIs · Custom-Built Features ·
                                    </span>
                                </div>
                            </div>
                        </div>
                    </section>
                </div>
            </MotionComponent>
            <Footer client:load>
                <div class="w-full flex justify-center flex-col items-center gap-3">
                    <Link href="https://discord.gg/6um5K6jrYj" prefetch={false} class="flex font-bricolage text-sm sm:text-base rounded-full bg-primary-500 px-5 py-4 font-semibold text-white transition-all hover:scale-105 active:scale-95 sm:px-6" >
                        Join our Discord
                    </Link>
                    <div class="mt-6 flex w-full items-center justify-center gap-2 text-xs sm:text-sm font-medium text-neutral-600 dark:text-neutral-400">
                        <span class="hover:text-primary-500 transition-colors duration-200">
                            <Link rel="noreferrer" href="/terms" >Terms of Service</Link></span>
                        <span class="text-gray-400 dark:text-gray-600">•</span>
                        <span class="hover:text-primary-500 transition-colors duration-200" >
                            <Link href="/privacy">Privacy Policy</Link>
                        </span>
                    </div>
                </div>
            </Footer>
        </div>
    )
})
