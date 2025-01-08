import { cn } from "./design";
import { $, component$, useOnDocument, useSignal } from "@builder.io/qwik";
import Avatar from "./avatar"

export const HomeNavBar = component$(() => {
    const hasScrolled = useSignal(false);

    useOnDocument(
        'scroll',
        $(() => {
            hasScrolled.value = window.scrollY > 0;
        })
    );
    //
    return (
        <nav class={cn("fixed w-full justify-between top-0 z-50 px-2 sm:px-6 text-xs sm:text-sm leading-[1] text-gray-950/70 dark:text-gray-50/70 h-[66px] before:backdrop-blur-[15px] before:absolute before:-z-[1] before:top-0 before:left-0 before:w-full before:h-full flex items-center", hasScrolled.value && "shadow-[0_2px_20px_1px] shadow-gray-700")} >
            <div class="flex flex-row justify-center relative items-center top-0 bottom-0">
                <div class="flex-shrink-0 gap-2 flex justify-center items-center">
                    <svg
                        class="size-8 "
                        width="100%"
                        height="100%"
                        viewBox="0 0 12.8778 9.7377253"
                        version="1.1"
                        id="svg1"
                        xmlns="http://www.w3.org/2000/svg">
                        <path
                            d="m 2.093439,1.7855532 h 8.690922 V 2.2639978 H 2.093439 Z m 0,2.8440874 h 8.690922 V 5.1080848 H 2.093439 Z m 0,2.8440866 h 8.690922 V 7.952172 H 2.093439 Z"
                            style="font-size:12px;fill:#ff4f01;fill-opacity:1;fill-rule:evenodd;stroke:#ff4f01;stroke-width:1.66201;stroke-linecap:round;stroke-dasharray:none;stroke-opacity:1" />
                    </svg>
                    {/* <svg viewBox="0 0 498.05 70.508" xmlns="http://www.w3.org/2000/svg"  class="aspect-[498/71] text-gray-200 w-[100px] h-auto" >
                        <g stroke-linecap="round" fill-rule="evenodd" font-size="9pt" stroke="currentColor" stroke-width="0.25mm" fill="currentColor">
                            <path
                                fill="currentColor"
                                pathLength="1"
                                stroke="currentColor"
                                d="M 261.23 41.65 L 212.402 41.65 Q 195.313 41.65 195.313 27.002 L 195.313 14.795 A 17.814 17.814 0 0 1 196.311 8.57 Q 199.443 0.146 212.402 0.146 L 283.203 0.146 L 283.203 14.844 L 217.236 14.844 Q 215.337 14.844 214.945 16.383 A 3.67 3.67 0 0 0 214.844 17.285 L 214.844 24.561 Q 214.844 27.002 217.236 27.002 L 266.113 27.002 Q 283.203 27.002 283.203 41.65 L 283.203 53.857 A 17.814 17.814 0 0 1 282.205 60.083 Q 279.073 68.506 266.113 68.506 L 195.313 68.506 L 195.313 53.809 L 261.23 53.809 A 3.515 3.515 0 0 0 262.197 53.688 Q 263.672 53.265 263.672 51.367 L 263.672 44.092 A 3.515 3.515 0 0 0 263.551 43.126 Q 263.128 41.65 261.23 41.65 Z M 185.547 53.906 L 185.547 68.506 L 114.746 68.506 Q 97.656 68.506 97.656 53.857 L 97.656 14.795 A 17.814 17.814 0 0 1 98.655 8.57 Q 101.787 0.146 114.746 0.146 L 168.457 0.146 Q 185.547 0.146 185.547 14.795 L 185.547 31.885 A 17.827 17.827 0 0 1 184.544 38.124 Q 181.621 45.972 170.174 46.538 A 36.906 36.906 0 0 1 168.457 46.582 L 117.188 46.582 L 117.236 51.465 Q 117.236 53.906 119.629 53.955 L 185.547 53.906 Z M 19.531 14.795 L 19.531 68.506 L 0 68.506 L 0 0.146 L 70.801 0.146 Q 87.891 0.146 87.891 14.795 L 87.891 68.506 L 68.359 68.506 L 68.359 17.236 Q 68.359 14.795 65.967 14.795 L 19.531 14.795 Z M 449.219 68.506 L 430.176 46.533 L 400.391 46.533 L 400.391 68.506 L 380.859 68.506 L 380.859 0.146 L 451.66 0.146 A 24.602 24.602 0 0 1 458.423 0.994 Q 466.007 3.166 468.021 10.907 A 25.178 25.178 0 0 1 468.75 17.236 L 468.75 31.885 A 18.217 18.217 0 0 1 467.887 37.73 Q 465.954 43.444 459.698 45.455 A 23.245 23.245 0 0 1 454.492 46.436 L 473.633 68.506 L 449.219 68.506 Z M 292.969 0 L 371.094 0.098 L 371.094 14.795 L 341.846 14.795 L 341.846 68.506 L 322.266 68.506 L 322.217 14.795 L 292.969 14.844 L 292.969 0 Z M 478.516 0.146 L 498.047 0.146 L 498.047 68.506 L 478.516 68.506 L 478.516 0.146 Z M 400.391 14.844 L 400.391 31.885 L 446.826 31.885 Q 448.726 31.885 449.117 30.345 A 3.67 3.67 0 0 0 449.219 29.443 L 449.219 17.285 Q 449.219 14.844 446.826 14.844 L 400.391 14.844 Z M 117.188 31.836 L 163.574 31.934 Q 165.528 31.895 165.918 30.355 A 3.514 3.514 0 0 0 166.016 29.492 L 166.016 17.236 Q 166.016 15.337 164.476 14.945 A 3.67 3.67 0 0 0 163.574 14.844 L 119.629 14.795 Q 117.188 14.795 117.188 17.188 L 117.188 31.836 Z" />
                        </g>
                    </svg> */}
                </div>
                <div class="relative z-[5] animate-fade-in items-center flex">
                    <hr class="bg-gray-700/70 w-0.5 rounded-md mx-3 rotate-[16deg] h-7 border-none" />
                    <button class="text-sm [&>svg:first-child]:size-5 rounded-full h-8 focus:bg-gray-700/70 focus:ring-primary-500 focus:ring-2 outline-none text-gray-400 gap-2 px-3 cursor-pointer inline-flex transition-all duration-150 items-center hover:bg-gray-700/70 ">
                        <Avatar name="WanjohiRyan's Team" />
                        <span class="truncate shrink max-w-[20ch]">WanjohiRyan's Team</span>
                        <svg xmlns="http://www.w3.org/2000/svg" class="size-4" width="32" height="32" viewBox="0 0 256 256"><path fill="currentColor" d="M72.61 83.06a8 8 0 0 1 1.73-8.72l48-48a8 8 0 0 1 11.32 0l48 48A8 8 0 0 1 176 88H80a8 8 0 0 1-7.39-4.94M176 168H80a8 8 0 0 0-5.66 13.66l48 48a8 8 0 0 0 11.32 0l48-48A8 8 0 0 0 176 168" /></svg>
                    </button>
                </div>
            </div>

            <div class="gap-4 flex flex-row justify-center h-full items-center">
                <button class="focus:ring-primary-500 [&>svg:first-child]:size-5 text-gray-400 text-sm focus:ring-2 outline-none rounded-full transition-all flex items-center duration-150 select-none cursor-pointer hover:bg-gray-700/70 focus:bg-gray-700/70 gap-1 px-3 h-8" >
                    <img src="https://avatars.githubusercontent.com/u/71614375?v=4" height={20} width={20} class="size-6 rounded-full" alt="Avatar" />
                    {/* <Avatar name="WanjohiRyan" /> */}
                    <span class="truncate shrink max-w-[20ch] sm:block hidden">WanjohiRyan</span>
                    <svg xmlns="http://www.w3.org/2000/svg" class="size-4 sm:block hidden" width="32" height="32" viewBox="0 0 256 256"><path fill="currentColor" d="M72.61 83.06a8 8 0 0 1 1.73-8.72l48-48a8 8 0 0 1 11.32 0l48 48A8 8 0 0 1 176 88H80a8 8 0 0 1-7.39-4.94M176 168H80a8 8 0 0 0-5.66 13.66l48 48a8 8 0 0 0 11.32 0l48-48A8 8 0 0 0 176 168" /></svg>
                </button>
            </div>
        </nav>
    )
})