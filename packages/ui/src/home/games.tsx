import type Nestri from "@nestri/sdk";
import { useNavigate } from "@builder.io/qwik-city";
import { $, component$, useOnDocument, useSignal, type QRL } from "@builder.io/qwik";

type Props = {
    getUserSubscription$: QRL<() => Promise<"Free" | "Pro" | undefined>>
    createSession$: QRL<() => Promise<Nestri.Tasks.TaskSessionResponse.Data | undefined>>
}

const skeletonGames = new Array(6).fill(0)

export const HomeGamesSection = component$(({ getUserSubscription$ }: Props) => { //createSession$
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const nav = useNavigate()
    const creatingSession = useSignal(false)
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

    const onClick = $(async () => {
        console.log("clicked")
        // creatingSession.value = true
        // const sessionID = await createSession$()
        // if (sessionID) {
        //     creatingSession.value = false
        //     await nav(`/play/${sessionID.id}`)
        // }
    });


    return (
        <div class="gap-2 w-full flex-col flex">
            <hr class="border-none h-[1.5px] dark:bg-gray-700 bg-gray-300 w-full" />
            <div class="text-gray-600/70 dark:text-gray-400/70 text-sm leading-none flex justify-start py-2 px-3 items-end">
                <span class="text-xl text-gray-700 dark:text-gray-300 leading-none font-bold font-title flex gap-2 ">
                    <svg xmlns="http://www.w3.org/2000/svg" class="flex-shrink-0 size-5" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 22c-.818 0-1.6-.33-3.163-.99C4.946 19.366 3 18.543 3 17.16V7m9 15c.818 0 1.6-.33 3.163-.99C19.054 19.366 21 18.543 21 17.16V7m-9 15V11.355M8.326 9.691L5.405 8.278C3.802 7.502 3 7.114 3 6.5s.802-1.002 2.405-1.778l2.92-1.413C10.13 2.436 11.03 2 12 2s1.871.436 3.674 1.309l2.921 1.413C20.198 5.498 21 5.886 21 6.5s-.802 1.002-2.405 1.778l-2.92 1.413C13.87 10.564 12.97 11 12 11s-1.871-.436-3.674-1.309M6 12l2 1m9-9L7 9" color="currentColor" /></svg>
                    Your Games
                </span>
                {/* {userSubscription.value ? (
                    <button disabled={userSubscription.value === "Free"} class="disabled:opacity-50 disabled:cursor-not-allowed ml-auto flex gap-1 items-center cursor-pointer [&:not(:disabled)]:hover:text-gray-800 dark:[&:not(:disabled)]:hover:text-gray-200 transition-all duration-200 outline-none">
                        <svg xmlns="http://www.w3.org/2000/svg" class="flex-shrink-0 size-5" viewBox="0 0 256 256"><path fill="currentColor" d="M248 128a87.34 87.34 0 0 1-17.6 52.81a8 8 0 1 1-12.8-9.62A71.34 71.34 0 0 0 232 128a72 72 0 0 0-144 0a8 8 0 0 1-16 0a88 88 0 0 1 3.29-23.88C74.2 104 73.1 104 72 104a48 48 0 0 0 0 96h24a8 8 0 0 1 0 16H72a64 64 0 1 1 9.29-127.32A88 88 0 0 1 248 128m-69.66 42.34L160 188.69V128a8 8 0 0 0-16 0v60.69l-18.34-18.35a8 8 0 0 0-11.32 11.32l32 32a8 8 0 0 0 11.32 0l32-32a8 8 0 0 0-11.32-11.32" /></svg>
                        <span>Install a game</span>
                    </button>
                ) : (
                    <div class="ml-auto h-4 w-28 rounded-md bg-gray-200 dark:gray-800 animate-pulse" />
                )} */}
            </div>
            <ul class="relative py-3 w-full list-none after:pointer-events-none after:select-none after:w-full after:h-[120px] after:fixed after:z-10 after:backdrop-blur-[1px] after:bg-gradient-to-b after:from-transparent after:to-gray-200 dark:after:to-gray-800 after:[-webkit-mask-image:linear-gradient(to_top,theme(colors.gray.200)_25%,transparent)] dark:after:[-webkit-mask-image:linear-gradient(to_top,theme(colors.gray.800)_25%,transparent)] after:left-0 after:-bottom-[1px]">
                {userSubscription.value ? (
                    <div class="flex flex-col items-center justify-center gap-6 px-6 py-20 w-full" >
                        <div class="relative flex items-center justify-center overflow-hidden rounded-[22px] p-[2px] before:absolute before:left-[-50%] before:top-[-50%] before:z-[-2] before:h-[200%] before:w-[200%] before:animate-[bgRotate_1.15s_linear_infinite] before:bg-[conic-gradient(from_0deg,transparent_0%,#ff4f01_10%,#ff4f01_25%,transparent_35%)] before:content-[''] after:absolute after:inset-[2px] after:z-[-1] after:content-['']" >
                            <div class="flex items-center justify-center rounded-[20px] bg-gray-200 dark:bg-gray-800 p-1">
                                <div class="flex items-center justify-center rounded-2xl bg-[#F5F5F5] p-1 dark:bg-[#171717]">
                                    <div class="flex h-[64px] w-[64px] items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-900">
                                        <svg xmlns="http://www.w3.org/2000/svg" width="32" class="h-8 w-8 shrink-0 dark:text-gray-700 text-gray-300" height="32" viewBox="0 0 24 24"><path fill="currentColor" d="M11.968 2C6.767 2 2.4 6.045 2.048 11.181l5.329 2.216c.45-.322.995-.45 1.573-.45h.128l2.344-3.5v-.031a3.74 3.74 0 0 1 3.756-3.756c2.087 0 3.788 1.67 3.788 3.756a3.74 3.74 0 0 1-3.756 3.756h-.096l-3.403 2.44v.128a2.863 2.863 0 0 1-2.857 2.857c-1.349 0-2.536-.995-2.761-2.247l-3.724-1.637C3.557 18.886 7.44 22 11.968 22c5.49-.032 9.984-4.494 9.984-10.016S17.457 2 11.968 2" /><path fill="currentColor" d="m8.276 17.152l-1.22-.481c.225.45.578.867 1.092 1.027c1.027.45 2.311-.032 2.76-1.123a2.07 2.07 0 0 0 0-1.638a2.26 2.26 0 0 0-1.123-1.187c-.514-.225-1.027-.193-1.54-.033l1.251.546c.77.353 1.188 1.252.867 2.023c-.353.802-1.252 1.155-2.087.866m9.502-7.736c0-1.349-1.124-2.536-2.536-2.536c-1.349 0-2.536 1.123-2.536 2.536c0 1.412 1.188 2.536 2.536 2.536s2.536-1.156 2.536-2.536m-4.366 0c0-1.027.867-1.862 1.862-1.862c1.027 0 1.862.867 1.862 1.862c0 1.027-.867 1.862-1.862 1.862c-1.027.032-1.862-.835-1.862-1.862" /></svg>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div class="flex flex-col items-center justify-center gap-1">
                            <span class="select-none text-center text-gray-700 dark:text-gray-300 font-title text-xl font-semibold sm:font-medium">Waiting for your first game install</span>
                            <p class="text-center text-base font-medium text-gray-600 dark:text-gray-400 sm:font-regular">Once you have installed  a game on your machine, it should appear here</p>
                        </div>
                        <button
                            onClick$={onClick}
                            // disabled={userSubscription.value === "Free"}
                            disabled
                            class="flex gap-2 h-[48px] disabled:cursor-not-allowed disabled:opacity-50 max-w-[360px] w-full select-none items-center justify-center rounded-full bg-primary-500 text-base font-semibold text-white transition-all duration-200 ease-out [&:not(:disabled)]:hover:ring-2 [&:not(:disabled)]:hover:ring-gray-600 dark:[&:not(:disabled)]:hover:ring-gray-400 [&:not(:disabled)]:focus:scale-95 [&:not(:disabled)]:active:scale-95 sm:font-medium">
                            {creatingSession.value &&
                                <div style={{ "--spinner-color": "#FFF" }} data-component="spinner">
                                    <div>
                                        {new Array(12).fill(0).map((i, k) => (
                                            <div key={k} />
                                        ))}
                                    </div>
                                </div>
                            }
                            <span> {creatingSession.value ? "Launching Steam" : "Launch Steam"}</span>
                        </button>
                    </div>
                ) : (
                    <div class="grid sm:grid-cols-3 grid-cols-2 gap-2 gap-y-3 w-full animate-pulse" >
                        {skeletonGames.map((_, key) => (
                            <div key={`skeleton-game-${key}`} class="w-full gap-2 flex flex-col" >
                                <div class="bg-gray-200 dark:bg-gray-800 w-full aspect-square rounded-2xl" />
                            </div>
                        ))}
                    </div>
                )}
            </ul >
        </div >
    )
})