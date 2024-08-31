import { component$ } from "@builder.io/qwik";
import { Link } from "@builder.io/qwik-city";
import { TitleSection, MotionComponent, transition  } from "@nestri/ui/react";
import { TeamCounter, NavBar, Footer } from "@nestri/ui"

export default component$(() => {
    return (
        <>
            <NavBar />
            <TitleSection client:load title="Pricing" description={["We're growing at the speed of trust.", "Start free, then choose a price that feels right for you."]} />
            <MotionComponent
                initial={{ opacity: 0, y: 100 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={transition}
                client:load
                class="flex items-center justify-center w-full"
                as="div"
            >
                <div class="px-2" >
                    <section class="flex flex-col gap-4 justify-center items-center mx-auto w-full text-left max-w-xl pb-4">
                        <div class="flex flex-col gap-4 justify-center items-center">
                            <div class="flex sm:flex-row flex-col w-[90%] sm:w-full h-min p-1.5 overflow-hidden bg-gray-200/70 ring-2 ring-gray-300 dark:ring-gray-700 dark:bg-gray-800/70 rounded-xl gap-4">
                                <div class="gap-3 w-full p-6 flex flex-col rounded-lg bg-white dark:bg-black">
                                    <div class="flex items-center font-title h-min w-full justify-between">
                                        <div class="flex items-center justify-center gap-2 ">
                                            <div class="bg-gradient-to-t from-[#d596ff] to-[rgb(145,147,255)] rounded-full h-4 w-4" />
                                            <p class="text-base font-semibold">Basic</p>
                                        </div>
                                        <p class="text-base font-medium">Free</p>
                                    </div>
                                    <div class="break-words [word-break:break-word] [text-wrap:balance] [word-wrap:break-word] w-full relative whitespace-pre-wrap">
                                        <p class="text-base text-gray-950/70 dark:text-gray-50/70">
                                            Perfect for casual gamers and those new to Nestri. Dive into cloud gaming without spending a dime.
                                        </p>
                                    </div>
                                    <div class="flex flex-col w-full gap-1.5">
                                        <p class="text-base font-medium font-title"> Your Team </p>
                                        <div class="flex items-center gap-1.5">
                                            <div class="bg-primary-200/70 dark:bg-primary-800/70 flex rounded-full py-[3px] pr-4 pl-[3px] justify-center items-center gap-2">
                                                <div class="bg-gradient-to-t from-primary-400 to-primary-600 rounded-full aspect-square relative overflow-hidden flex justify-center items-center" >
                                                    <p class="text-sm font-medium text-primary-50 text-center p-2">
                                                        Y
                                                    </p>
                                                </div>
                                                <p class="text-sm font-medium text-primary-500">
                                                    You
                                                </p>
                                            </div>
                                            <div class="bg-gray-200/70 dark:bg-gray-800 flex rounded-full relative size-[32px] overflow-hidden items-center justify-center">
                                                <p class="text-lg font-normal font-title">+1</p>
                                            </div>
                                        </div>
                                    </div>
                                    <hr class="h-[2px] bg-gray-200 dark:bg-gray-800" />
                                    <div class="w-full relative sm:text-sm text-base gap-3 flex flex-col">
                                        <div class="flex item-center flex-col gap-2 w-full">
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24"><path fill="currentColor" d="M8.21 17.32L7 16.8a2.13 2.13 0 1 0 1.17-2.93l1.28.53a1.58 1.58 0 0 1-1.22 2.92z" /><path fill="currentColor" d="M12 2a10 10 0 0 0-10 9.34l5.38 2.21a2.31 2.31 0 0 1 .47-.24A2.62 2.62 0 0 1 9 13.1l2.44-3.56a3.8 3.8 0 1 1 3.8 3.8h-.08l-3.51 2.5a2.77 2.77 0 0 1-5.47.68l-3.77-1.6A10 10 0 1 0 12 2" /><path fill="currentColor" d="M17.79 9.5a2.53 2.53 0 1 0-2.53 2.5a2.54 2.54 0 0 0 2.53-2.5m-4.42 0a1.9 1.9 0 1 1 1.9 1.91a1.9 1.9 0 0 1-1.9-1.92z" /></svg>
                                                </div>
                                                <p class="group relative">Add upto&nbsp;<span class="">3 games</span>&nbsp;at a time</p>
                                            </div>
                                        </div>
                                        <div class="gap-2.5 flex relative items-center w-full" >
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
                                        </div>
                                        <div class="gap-2.5 flex relative items-center w-full" >
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24"><path fill="currentColor" d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2S2 6.477 2 12s4.477 10 10 10" opacity=".5" /><path fill="currentColor" fill-rule="evenodd" d="M12 7.25a.75.75 0 0 1 .75.75v3.69l2.28 2.28a.75.75 0 1 1-1.06 1.06l-2.5-2.5a.75.75 0 0 1-.22-.53V8a.75.75 0 0 1 .75-.75" clip-rule="evenodd" /></svg>
                                                </div>
                                                <p><span class="">3 hours</span>&nbsp;of daily playtime</p>
                                            </div>
                                        </div>
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
                                </div>
                                <div class="gap-3 w-full p-6 flex flex-col rounded-lg">
                                    <div class="flex items-center font-title h-min w-full justify-between">
                                        <div class="flex items-center justify-center gap-2 ">
                                            <div class="bg-gradient-to-t from-[#685fea] to-[rgb(153,148,224)] rounded-full h-4 w-4" />
                                            <h1 class="text-base font-semibold">Pro</h1>
                                        </div>
                                        {/**FIXME: Add a ticker for pricing, when we figure it out */}
                                        <h2 class="text-base font-medium">TBD</h2>
                                    </div>
                                    <div class="break-words [word-break:break-word] [text-wrap:balance] [word-wrap:break-word] w-full relative whitespace-pre-wrap">
                                        <p class="text-base text-gray-950/70 dark:text-gray-50/70">
                                            Ideal for dedicated gamers who crave more power, flexibility, and social gaming experiences.
                                        </p>
                                    </div>
                                    <div class="flex flex-col w-full gap-1.5">
                                        <p class="text-base font-medium font-title">Your Team </p>
                                        <div class="flex items-center gap-1.5">
                                            <div class="bg-primary-200/70 dark:bg-primary-800/70 flex rounded-full py-[3px] pr-4 pl-[3px] justify-center items-center gap-2">
                                                {/** Avatar Placeholder*/}
                                                <div class="bg-gradient-to-t from-primary-400 to-primary-600 rounded-full aspect-square relative overflow-hidden flex justify-center items-center" >
                                                    <p class="text-sm font-medium text-primary-50 text-center p-2">
                                                        Y
                                                    </p>
                                                </div>
                                                <p class="text-sm font-medium text-primary-500">
                                                    You
                                                </p>
                                            </div>
                                            <TeamCounter class="h-[30px]" />
                                        </div>
                                    </div>
                                    <hr class="h-[2px] bg-gray-300 dark:bg-gray-700" />
                                    <div class="w-full sm:text-sm text-base relative gap-3 flex flex-col">
                                        <div class="flex item-center flex-col gap-2 w-full">
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24"><path fill="currentColor" d="M8.21 17.32L7 16.8a2.13 2.13 0 1 0 1.17-2.93l1.28.53a1.58 1.58 0 0 1-1.22 2.92z" /><path fill="currentColor" d="M12 2a10 10 0 0 0-10 9.34l5.38 2.21a2.31 2.31 0 0 1 .47-.24A2.62 2.62 0 0 1 9 13.1l2.44-3.56a3.8 3.8 0 1 1 3.8 3.8h-.08l-3.51 2.5a2.77 2.77 0 0 1-5.47.68l-3.77-1.6A10 10 0 1 0 12 2" /><path fill="currentColor" d="M17.79 9.5a2.53 2.53 0 1 0-2.53 2.5a2.54 2.54 0 0 0 2.53-2.5m-4.42 0a1.9 1.9 0 1 1 1.9 1.91a1.9 1.9 0 0 1-1.9-1.92z" /></svg>
                                                </div>
                                                <p>Add upto&nbsp;<span class="">7 games</span></p>
                                                <div class="py-0.5 text-xs font-title rounded-full bg-gray-300 dark:bg-gray-700 px-1.5" >
                                                    <p>+$3/game</p>
                                                </div>
                                            </div>
                                        </div>
                                        <div class="gap-2.5 flex relative items-center w-full" >
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
                                        </div>
                                        <div class="gap-2.5 flex relative items-center w-full" >
                                            <div class="gap-1.5 flex w-full items-center text-neutral-900/70 dark:text-neutral-100/70" >
                                                <div class="size-5 relative">
                                                    <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" viewBox="0 0 24 24"><path fill="currentColor" d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2S2 6.477 2 12s4.477 10 10 10" opacity=".5" /><path fill="currentColor" fill-rule="evenodd" d="M12 7.25a.75.75 0 0 1 .75.75v3.69l2.28 2.28a.75.75 0 1 1-1.06 1.06l-2.5-2.5a.75.75 0 0 1-.22-.53V8a.75.75 0 0 1 .75-.75" clip-rule="evenodd" /></svg>
                                                </div>
                                                <p><span class="">Unlimited</span>&nbsp;daily playtime</p>
                                            </div>
                                        </div>
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
                                </div>
                            </div>
                        </div>
                        <div class="bg-gray-200/70 dark:bg-gray-800/70 ring-2 ring-gray-300 dark:ring-gray-700 rounded-xl p-6 w-[90%] sm:w-full" >
                            <div class="flex gap-3 relative w-full flex-col" >
                                <div class="w-full flex items-center gap-2" >
                                    <div class="rounded-full size-4 overflow-hidden bg-gradient-to-tr from-[#a0f906] to-[#e60d0d]" />
                                    <p class="text-base font-medium">Enterprise</p>
                                </div>
                                <p class="text-neutral-900/70 dark:text-neutral-100/70 text-base" >
                                    Looking for a custom cloud gaming platform? Use Nestri as your own on our servers or yours. Flexible licensing and white-glove onboarding included.
                                </p>
                                <Link class="underline underline-offset-1 font-medium font-title hover:opacity-70" href="mailto:enterprise@nestri.io">
                                    Let's Chat
                                </Link>
                            </div>
                        </div>
                    </section>
                </div>
            </MotionComponent>
            <Footer />
        </>
    )
})