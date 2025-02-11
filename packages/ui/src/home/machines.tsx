/* eslint-disable qwik/jsx-img */
import { cn } from "../design";
import { MotionComponent } from "../react";
import { $, component$, useOnDocument, useSignal, type QRL } from "@builder.io/qwik";
import { Link } from "@builder.io/qwik-city";

type Props = {
    getUserSubscription$: QRL<() => Promise<"Free" | "Pro" | undefined>>
}

export const HomeMachineSection = component$(({ getUserSubscription$ }: Props) => {
    const isHovered = useSignal(false)
    const userSubscription = useSignal<"Free" | "Pro" | undefined>()

    useOnDocument("load", $(async () => {
        const userSub = sessionStorage.getItem("subscription_data")
        if (userSub) {
            userSubscription.value = JSON.parse(userSub)
        } else {
            const subscription = await getUserSubscription$()
            sessionStorage.setItem("subscription_data", JSON.stringify(subscription))
            userSubscription.value = subscription
        }
    }))

    return (
        <div class="flex flex-col gap-6 w-full py-4">
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {userSubscription.value ? (
                    <>
                        {userSubscription.value == "Pro" ? (
                            <div class="w-full animate-fade-in opacity-0 transition-all duration-200 ease-in" >
                                <Link href="/machine" class="w-full border-gray-400/70 dark:border-gray-700/70 hover:ring-2 hover:ring-[#8f8f8f] dark:hover:ring-[#707070] outline-none group transition-all duration-200  border-[2px]  h-14  rounded-xl  px-4  gap-2  flex  items-center  justify-between  overflow-hidden bg-white dark:bg-black hover:bg-gray-300/70 dark:hover:bg-gray-700/70 disabled:opacity-50">
                                    <div class="py-2 w-2/3 flex truncate group">
                                        <div class="flex items-center justify-between group gap-2">
                                            <div class="flex items-center w-auto gap-2 overflow-hidden">
                                                <div class="flex items-center gap-2">
                                                    <div class="w-auto select-none text-nowrap font-medium transition-colors duration-200 ease-out group-hover:text-black text-black/80 dark:group-hover:text-white dark:text-white/80">Steam Machine</div>
                                                </div>
                                            </div>
                                            {/* <div class="select-none flex gap-1 items-center overflow-hidden rounded-md px-2 py-1 text-xs font-medium transition-colors duration-200 ease-out" > */}
                                            <div class={cn("select-none overflow-hidden flex gap-1 uppercase items-center rounded-md px-2 py-1 text-xs font-medium transition-colors duration-200 ease-out", userSubscription.value === "Pro" ? "bg-[#0CCE6B]/30 text-[#0CCE6B] group-hover:bg-[#0CCE6B]/40" : " bg-[#EE0048]/30 text-[#EE0048] hover:bg-[#EE0048]/40")}>
                                                <div class={cn("size-2 rounded-full", userSubscription.value == "Pro" ? "bg-[#0CCE6B]" : "bg-[#EE0048]")} />
                                                <span>{userSubscription.value == "Pro" ? "Online" : "Error"}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div
                                        style={{
                                            "--cutout-avatar-percentage-visible": 0.2,
                                            "--head-margin-percentage": 0.1,
                                            "--size": "3rem"
                                        }}
                                        class="relative h-full flex w-[20%] justify-end">
                                        <img draggable={false} alt="game" width={256} height={256} src="/images/steam.png" class="h-12 shadow-lg shadow-gray-900 ring-gray-400/70 ring-1 bg-black w-12 translate-y-4 rotate-[14deg] rounded-lg object-cover transition-transform sm:h-16 sm:w-16 group-hover:scale-110" />
                                    </div>
                                </Link>
                            </div>
                        ) : (
                            <div class="w-full animate-fade-in opacity-0 transition-all duration-200 ease-in relative">
                                <MotionComponent
                                    client:load
                                    as="span"
                                    initial={{ x: 80, y: 0, rotate: 0 }}
                                    animate={{
                                        x: isHovered.value ? 5 : 80,
                                        y: isHovered.value ? -20 : 0,
                                        rotate: isHovered.value ? 720 : 0
                                    }}
                                    transition={{
                                        type: "spring",
                                        stiffness: 200,
                                        damping: 15,
                                    }}
                                    class="absolute text-[#99CCFF] flex items-center justify-center z-[1]">
                                    <svg height="16" class="size-10" stroke-linejoin="round" viewBox="0 0 16 16" width="16" color="currentColor">
                                        <path fill-rule="evenodd" clip-rule="evenodd" d="M9.49999 0H6.49999L6.22628 1.45975C6.1916 1.64472 6.05544 1.79299 5.87755 1.85441C5.6298 1.93996 5.38883 2.04007 5.15568 2.15371C4.98644 2.2362 4.78522 2.22767 4.62984 2.12136L3.40379 1.28249L1.28247 3.40381L2.12135 4.62986C2.22766 4.78524 2.23619 4.98646 2.1537 5.15569C2.04005 5.38885 1.93995 5.62981 1.8544 5.87756C1.79297 6.05545 1.6447 6.19162 1.45973 6.2263L0 6.5V9.5L1.45973 9.7737C1.6447 9.80838 1.79297 9.94455 1.8544 10.1224C1.93995 10.3702 2.04006 10.6112 2.1537 10.8443C2.23619 11.0136 2.22767 11.2148 2.12136 11.3702L1.28249 12.5962L3.40381 14.7175L4.62985 13.8786C4.78523 13.7723 4.98645 13.7638 5.15569 13.8463C5.38884 13.9599 5.6298 14.06 5.87755 14.1456C6.05544 14.207 6.1916 14.3553 6.22628 14.5403L6.49999 16H9.49999L9.77369 14.5403C9.80837 14.3553 9.94454 14.207 10.1224 14.1456C10.3702 14.06 10.6111 13.9599 10.8443 13.8463C11.0135 13.7638 11.2147 13.7723 11.3701 13.8786L12.5962 14.7175L14.7175 12.5962L13.8786 11.3701C13.7723 11.2148 13.7638 11.0135 13.8463 10.8443C13.9599 10.6112 14.06 10.3702 14.1456 10.1224C14.207 9.94455 14.3553 9.80839 14.5402 9.7737L16 9.5V6.5L14.5402 6.2263C14.3553 6.19161 14.207 6.05545 14.1456 5.87756C14.06 5.62981 13.9599 5.38885 13.8463 5.1557C13.7638 4.98647 13.7723 4.78525 13.8786 4.62987L14.7175 3.40381L12.5962 1.28249L11.3701 2.12137C11.2148 2.22768 11.0135 2.2362 10.8443 2.15371C10.6111 2.04007 10.3702 1.93996 10.1224 1.85441C9.94454 1.79299 9.80837 1.64472 9.77369 1.45974L9.49999 0ZM8 11C9.65685 11 11 9.65685 11 8C11 6.34315 9.65685 5 8 5C6.34315 5 5 6.34315 5 8C5 9.65685 6.34315 11 8 11Z" fill="currentColor"></path>
                                    </svg>
                                </MotionComponent>
                                <MotionComponent
                                    as="span"
                                    client:load
                                    initial={{ x: 80, y: 0, rotate: 0 }}
                                    animate={{
                                        x: isHovered.value ? 100 : 20,
                                        y: isHovered.value ? 35 : 0,
                                        rotate: isHovered.value ? 720 : 0
                                    }}
                                    transition={{
                                        type: "spring",
                                        stiffness: 200,
                                        damping: 15,
                                    }}
                                    class="absolute text-[#99CCFF] flex items-center justify-center z-[1]">
                                    <svg height="16" class="size-10" stroke-linejoin="round" viewBox="0 0 16 16" width="16" color="currentColor">
                                        <path fill-rule="evenodd" clip-rule="evenodd" d="M9.49999 0H6.49999L6.22628 1.45975C6.1916 1.64472 6.05544 1.79299 5.87755 1.85441C5.6298 1.93996 5.38883 2.04007 5.15568 2.15371C4.98644 2.2362 4.78522 2.22767 4.62984 2.12136L3.40379 1.28249L1.28247 3.40381L2.12135 4.62986C2.22766 4.78524 2.23619 4.98646 2.1537 5.15569C2.04005 5.38885 1.93995 5.62981 1.8544 5.87756C1.79297 6.05545 1.6447 6.19162 1.45973 6.2263L0 6.5V9.5L1.45973 9.7737C1.6447 9.80838 1.79297 9.94455 1.8544 10.1224C1.93995 10.3702 2.04006 10.6112 2.1537 10.8443C2.23619 11.0136 2.22767 11.2148 2.12136 11.3702L1.28249 12.5962L3.40381 14.7175L4.62985 13.8786C4.78523 13.7723 4.98645 13.7638 5.15569 13.8463C5.38884 13.9599 5.6298 14.06 5.87755 14.1456C6.05544 14.207 6.1916 14.3553 6.22628 14.5403L6.49999 16H9.49999L9.77369 14.5403C9.80837 14.3553 9.94454 14.207 10.1224 14.1456C10.3702 14.06 10.6111 13.9599 10.8443 13.8463C11.0135 13.7638 11.2147 13.7723 11.3701 13.8786L12.5962 14.7175L14.7175 12.5962L13.8786 11.3701C13.7723 11.2148 13.7638 11.0135 13.8463 10.8443C13.9599 10.6112 14.06 10.3702 14.1456 10.1224C14.207 9.94455 14.3553 9.80839 14.5402 9.7737L16 9.5V6.5L14.5402 6.2263C14.3553 6.19161 14.207 6.05545 14.1456 5.87756C14.06 5.62981 13.9599 5.38885 13.8463 5.1557C13.7638 4.98647 13.7723 4.78525 13.8786 4.62987L14.7175 3.40381L12.5962 1.28249L11.3701 2.12137C11.2148 2.22768 11.0135 2.2362 10.8443 2.15371C10.6111 2.04007 10.3702 1.93996 10.1224 1.85441C9.94454 1.79299 9.80837 1.64472 9.77369 1.45974L9.49999 0ZM8 11C9.65685 11 11 9.65685 11 8C11 6.34315 9.65685 5 8 5C6.34315 5 5 6.34315 5 8C5 9.65685 6.34315 11 8 11Z" fill="currentColor"></path>
                                    </svg>
                                </MotionComponent>
                                <div class="hover:border-[#99CCFF]/70 border-gray-300 dark:border-gray-700 bg-white dark:bg-black z-[5] relative w-full transition-all duration-300 border-[2px] h-14 rounded-xl px-4 gap-2 flex items-center justify-between overflow-hidden outline-none disabled:opacity-50">
                                    <span class="p-2 pl-0 text-gray-800/70 dark:text-gray-200/70 leading-none shrink truncate flex text-start items-center gap-2">
                                        <a
                                            onMouseEnter$={() => isHovered.value = true}
                                            onMouseLeave$={() => isHovered.value = false}
                                            href="https://polar.sh/nestri" class="dark:text-white text-black border-b border-[#99CCFF] py-0.5">Upgrade to Pro</a>&nbsp;to get a machine
                                    </span>
                                </div>
                            </div>
                        )}
                        <button class="w-full animate-fade-in opacity-0 transition-all duration-200 ease-in">
                            <div class="border-gray-400/70 w-full dark:border-gray-700/70 transition-all border-dashed duration-200 border-[2px] h-14 rounded-xl px-4 gap-2 flex items-center justify-between overflow-hidden outline-none disabled:opacity-50">
                                <span class="p-2 pl-0 text-gray-600/70 dark:text-gray-400/70 leading-none shrink truncate flex text-start items-center gap-2">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="flex-shrink-0 size-5" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M11.505 2h-1.501c-3.281 0-4.921 0-6.084.814a4.5 4.5 0 0 0-1.106 1.105C2 5.08 2 6.72 2 10s0 4.919.814 6.081a4.5 4.5 0 0 0 1.106 1.105C5.083 18 6.723 18 10.004 18h4.002c3.28 0 4.921 0 6.084-.814a4.5 4.5 0 0 0 1.105-1.105c.63-.897.772-2.08.805-4.081m-8-6h4m0 0h4m-4 0V2m0 4v4m-7 5h2m-1 3v4m-4 0h8" color="currentColor" /></svg>
                                    Add your machine
                                    <div class="select-none text-[#ff990a] bg-[#ff990a]/30  h-max uppercase overflow-hidden rounded-md px-2 py-1 text-xs transition-colors duration-200 ease-out font-semibold font-title">
                                        <span>Soon</span>
                                    </div>
                                </span>
                            </div>
                        </button>
                    </>
                ) :
                    new Array(2).fill(0).map((_, key) => (
                        <div class="w-full animate-pulse" key={`skeleton-machine-${key}`}>
                            <div class="rounded-xl bg-gray-200 dark:bg-gray-800 h-14 w-full" />
                        </div>
                    ))
                }
            </div>
        </div >
    )
})