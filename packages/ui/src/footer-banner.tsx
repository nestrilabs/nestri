import Book from "./book";
import { CONSTANTS } from "./constants";
import { Link } from "@builder.io/qwik-city";
import { MotionComponent, transition } from "@nestri/ui/react";
import { component$, useSignal, useVisibleTask$ } from "@builder.io/qwik";

export const FooterBanner = component$(() => {
    const docsLinkRef = useSignal<HTMLElement | undefined>()
    const bookRef = useSignal<HTMLElement | undefined>()

    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(() => {
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
    return (
        <MotionComponent
            initial={{ opacity: 0, y: 100 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={transition}
            client:load
            class="flex items-center justify-center w-screen px-4 py-10"
            as="div"
        >
            <section class="w-full flex flex-col items-center justify-center">
                <div class="w-full max-w-2xl mx-auto">
                    <div class="z-[2] h-max md:flex-row flex-col relative overflow-hidden flex justify-between md:items-center gap-6 px-6 pt-6 bg-white dark:bg-black ring-2 ring-gray-300 dark:ring-gray-700 rounded-xl">
                        <div class="w-full h-max md:pb-6">
                            <div class="gap-3 w-full flex flex-col">
                                <div class="flex w-full flex-col text-neutral-900/70 dark:text-neutral-100/70 gap-1" >
                                    <p class="text-lg font-medium text-balance tracking-tight leading-tight">
                                        <b class="text-black dark:text-white font-semibold text-2xl text-balance tracking-[-.96px] leading-tight font-title">Ready to start playing?</b>
                                        <br />
                                        Dive into the documentation or unlock premium features with <u class="font-bold [text-decoration:none]" >Nestri Pro</u>
                                    </p>
                                </div>
                                <div class="flex md:flex-row flex-col w-full gap-2 h-max md:items-center">
                                    <Link href="/pricing" class="h-max w-max relative overflow-hidden rounded-lg flex justify-center text-gray-500 dark:text-gray-100/70 font-title font-bold items-center group py-2 px-4">
                                        <span class="invisible"> Get Nestri Pro</span>
                                        <div class="animate-multicolor before:-z-[1] -z-[2] absolute -right-full left-0 bottom-0 h-full w-[1000px] [background:linear-gradient(90deg,rgb(232,23,98)_1.26%,rgb(30,134,248)_18.6%,rgb(91,108,255)_34.56%,rgb(52,199,89)_49.76%,rgb(245,197,5)_64.87%,rgb(236,62,62)_85.7%)_0%_0%/50%_100%_repeat-x]" />
                                        <div class="select-none absolute justify-center items-center min-w-max inset-auto flex z-[2] rounded-md h-[83%] w-[96%] bg-white dark:bg-black group-hover:bg-transparent transition-all duration-200">
                                            <span class="text-sm group-hover:text-white w-full transition-all duration-200">
                                                <div class="flex justify-around items-center w-full h-max">
                                                    Get Nestri Pro
                                                </div>
                                            </span>
                                        </div>
                                    </Link>
                                    <a href={CONSTANTS.githubLink} ref={v => docsLinkRef.value = v} class="w-max focus:ring-primary-500 hover:ring-primary-500 ring-gray-500 rounded-lg outline-none dark:text-gray-100/70 ring-2 text-sm h-max py-2 px-4 flex items-center transition-all duration-200 focus:bg-primary-100 focus:dark:bg-primary-900 focus:text-primary-500 text-gray-500 font-title font-bold justify-between">
                                        <div class="size-5 relative mr-2">
                                            <svg xmlns="http://www.w3.org/2000/svg" class="w-full h-full" height={20} width={20} viewBox="0 0 24 24"><path fill="currentColor" fill-rule="evenodd" d="M14.25 4.48v3.057c0 .111 0 .27.021.406a.94.94 0 0 0 .444.683a.96.96 0 0 0 .783.072c.13-.04.272-.108.378-.159L17 8.005l1.124.534c.106.05.248.119.378.16a.96.96 0 0 0 .783-.073a.94.94 0 0 0 .444-.683c.022-.136.021-.295.021-.406V3.031q.17-.008.332-.013C21.154 2.98 22 3.86 22 4.933v11.21c0 1.112-.906 2.01-2.015 2.08c-.97.06-2.108.179-2.985.41c-1.082.286-2.373.904-3.372 1.436q-.422.224-.878.323V5.174a3.6 3.6 0 0 0 .924-.371q.277-.162.576-.323m5.478 8.338a.75.75 0 0 1-.546.91l-4 1a.75.75 0 1 1-.364-1.456l4-1a.75.75 0 0 1 .91.546M11.25 5.214a3.4 3.4 0 0 1-.968-.339C9.296 4.354 8.05 3.765 7 3.487c-.887-.233-2.041-.352-3.018-.412C2.886 3.008 2 3.9 2 4.998v11.146c0 1.11.906 2.01 2.015 2.079c.97.06 2.108.179 2.985.41c1.081.286 2.373.904 3.372 1.436q.422.224.878.324zM4.273 8.818a.75.75 0 0 1 .91-.546l4 1a.75.75 0 1 1-.365 1.456l-4-1a.75.75 0 0 1-.545-.91m.91 3.454a.75.75 0 1 0-.365 1.456l4 1a.75.75 0 0 0 .364-1.456z" clip-rule="evenodd" /><path fill="currentColor" d="M18.25 3.151c-.62.073-1.23.18-1.75.336a8 8 0 0 0-.75.27v3.182l.75-.356l.008-.005a1.1 1.1 0 0 1 .492-.13q.072 0 .138.01c.175.029.315.1.354.12l.009.005l.75.356V3.15" /></svg>
                                        </div>
                                        Read the Docs
                                    </a>
                                </div>
                            </div>
                        </div>
                        <a href={CONSTANTS.githubLink} ref={v => bookRef.value = v} class="h-full max-h-[160px] pt-4 md:w-[65%] w-full flex items-start justify-center overflow-hidden outline-none">
                            <Book
                                textColor="#FFF"
                                bgColor="#FF4F01"
                                title="Getting started with Nestri" class="shadow-lg shadow-gray-900 dark:shadow-gray-300" />
                        </a>
                        <div class="animate-multicolor absolute blur-[2px] -right-full left-0 -bottom-[2px] h-4 [background:linear-gradient(90deg,rgb(232,23,98)_1.26%,rgb(30,134,248)_18.6%,rgb(91,108,255)_34.56%,rgb(52,199,89)_49.76%,rgb(245,197,5)_64.87%,rgb(236,62,62)_85.7%)_0%_0%/50%_100%_repeat-x]" />
                    </div>
                </div>
            </section>
        </MotionComponent>
    );
});