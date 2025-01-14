/* eslint-disable qwik/jsx-img */
import { Footer } from "@nestri/ui";
import { Link } from "@builder.io/qwik-city";
import { component$ } from "@builder.io/qwik";
import { MotionComponent, transition, TitleSection } from "@nestri/ui/react";

export default component$(() => {
    return (
        <>
            <TitleSection client:load title="Changelog" description="All the latest updates, improvements, and fixes to Nestri." />
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
                    <section class="flex flex-col gap-4 overflow-hidden mx-auto w-full text-left max-w-xl pb-4">
                        <div class="w-full justify-between flex">
                            <h2 class="relative pl-8 font-medium font-title text-base before:absolute before:left-0 before:top-1 before:w-4 before:h-4 before:bg-primary-500 before:rounded-full after:absolute after:left-0.5 after:top-1.5 after:w-3 after:h-3 after:bg-gray-50 after:dark:bg-gray-950 after:rounded-full">
                                v0.0.3
                            </h2>
                            <p class="text-sm pr-2.5">August 2024</p>
                        </div>
                        <div class="pt-2 pb-4 pr-2 pl-4 md:pl-8 h-max gap-4 flex flex-col relative before:absolute before:bottom-2 before:top-0 before:left-[7px] before:w-0.5 before:bg-gradient-to-b before:rounded-[2px] before:from-primary-500 before:to-transparent" >
                            <div class="flex flex-row flex-wrap gap-2.5">
                                <div class="aspect-auto h-max rounded-2xl overflow-hidden shadow-sm flex relative basis-full after:absolute after:inset-0 after:z-[3] bg-white dark:bg-black select-none ring-2 ring-gray-300 dark:ring-gray-700 p-5 text-neutral-900/70 dark:text-neutral-100/70">
                                    <div class="text-base backdrop-blur-sm font-title font-medium text-white z-[2] w-full h-full text-center p-4 justify-center items-center flex flex-col">
                                        <p class="text-2xl">Fresh new look, Intel & AMD GPU support and we finally launched 🥳</p>
                                    </div>
                                    <div class="absolute inset-0 z-0">
                                        <img draggable={false} src="/changelog/v0.0.3/header.avif" alt="Nestri Logo" height={328} width={328} class="w-full h-full object-cover" />
                                    </div>
                                </div>
                                <div class="aspect-square h-max rounded-2xl overflow-hidden shadow-sm flex relative basis-full after:absolute after:inset-0 after:z-[3] bg-white dark:bg-black select-none ring-2 ring-gray-300 dark:ring-gray-700 p-5 text-neutral-900/70 dark:text-neutral-100/70">
                                    <div class="text-lg font-title font-medium text-white z-[2] w-full h-full text-center p-4  justify-end flex flex-col">
                                        <p class="m-4 backdrop-blur-sm" >Fresh new logo and branding 💅🏾</p>
                                    </div>
                                    <div class="absolute inset-0 z-0">
                                        <img draggable={false} src="/changelog/v0.0.3/new-website-design.avif" alt="Nestri Logo" height={328} width={328} class="w-full h-full object-cover" />
                                    </div>
                                </div>
                                <div class="h-max aspect-auto rounded-2xl overflow-hidden shadow-sm flex relative basis-full after:absolute after:pointer-events-none after:inset-0 after:z-[3] bg-white dark:bg-black select-none ring-2 ring-gray-300 dark:ring-gray-700 p-5 text-neutral-900/70 dark:text-neutral-100/70">
                                    <div class="justify-center items-center flex w-full">
                                        <p class="text-xl font-title text-center font-medium">Updated our <Link class="underline" href="/terms">Terms of Service</Link> <br class="hidden md:block" /> and our <Link class="underline" href="/privacy">Privacy Policy</Link></p>
                                    </div>
                                </div>
                                <div class="h-max md:aspect-square aspect-auto rounded-2xl overflow-hidden shadow-sm flex relative sm:basis-[calc(50%-5px)] basis-full after:absolute after:pointer-events-none after:inset-0 after:z-[3] bg-white dark:bg-black select-none ring-2 ring-gray-300 dark:ring-gray-700 p-5 text-neutral-900/70 dark:text-neutral-100/70">
                                    <div class="justify-center items-center flex w-full">
                                        <p class="text-xl font-title text-center font-medium">Added support for Intel & AMD GPUs. Courtesy of{" "}<Link class="underline" href="https://github.com/DatCaptainHorse">@DatHorse</Link></p>
                                    </div>
                                </div>
                                <div class="h-max aspect-square rounded-2xl overflow-hidden shadow-sm flex relative sm:basis-[calc(50%-5px)] basis-full after:absolute after:pointer-events-none after:inset-0 after:z-[3] bg-white dark:bg-black select-none ring-2 ring-gray-300 dark:ring-gray-700 p-5 text-neutral-900/70 dark:text-neutral-100/70">
                                    <div class="absolute inset-0 z-0">
                                        <img draggable={false} src="/changelog/v0.0.3/gameplay.avifs" alt="Nestri Logo" height={328} width={328} class="w-full h-full object-cover" />
                                    </div>
                                </div>
                                <div class="h-max aspect-auto rounded-2xl overflow-hidden shadow-sm flex relative basis-full after:absolute after:inset-0 after:z-[3] bg-white dark:bg-black select-none ring-2 ring-gray-300 dark:ring-gray-700 p-5 text-neutral-900/70 dark:text-neutral-100/70">
                                    <div class="justify-center items-center flex w-full">
                                        <p class="text-lg font-title text-center font-medium">+ Lots of quality of life improvements! 🤞🏽</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </section >
                    <section class="flex flex-col gap-4 overflow-hidden mx-auto w-full text-left max-w-xl pt-2 pb-4">
                        <div class="w-full justify-between flex">
                            <h2 class="relative pl-8 font-medium font-title text-base before:absolute before:left-0 before:top-1 before:w-4 before:h-4 before:bg-primary-500 before:rounded-full after:absolute after:left-0.5 after:top-1.5 after:w-3 after:h-3 after:bg-gray-50 after:dark:bg-gray-950 after:rounded-full">
                                v0.0.2
                            </h2>
                            <p class="text-sm pr-2.5">June 2024</p>
                        </div>
                        <div class="pt-2 pb-4 pr-2 pl-4 md:pl-8 h-max relative before:absolute before:bottom-2 before:top-0 before:left-[7px] before:w-0.5 before:bg-gradient-to-b before:rounded-[2px] before:from-primary-500 before:to-transparent" >
                            <div class="flex flex-row flex-wrap gap-2.5">
                                <div class="h-max justify-center aspect-auto rounded-2xl overflow-hidden shadow-sm flex relative basis-full after:absolute after:inset-0 after:z-[3] bg-white dark:bg-black select-none ring-2 ring-gray-300 dark:ring-gray-700 p-5 text-neutral-900/70 dark:text-neutral-100/70">
                                    <p class="text-lg font-title text-center font-medium">Nestri has been long overdue for a changelog. <br class="hidden md:block" /> Welcome to our changelog!</p>
                                </div>
                            </div>
                        </div>
                    </section>
                </div >
            </MotionComponent>
            <Footer />
        </>
    )
})