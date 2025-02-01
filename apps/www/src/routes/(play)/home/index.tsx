import type Nestri from "@nestri/sdk";
import { Avatar, GameStoreButton } from "@nestri/ui";
import { cn } from "@nestri/ui/design";
import { component$ } from "@builder.io/qwik";
import { routeLoader$ } from "@builder.io/qwik-city";
import { HomeNavBar } from "@nestri/ui";

const games = [
    {
        id: 2507950,
        name: "Delta Force",
        image: "https://assets-prd.ignimgs.com/2024/08/28/delta-force-button-replacement-1724855313566.jpg"
    },
    {
        id: 870780,
        name: "Control Ultimate Edition",
        image: "https://assets-prd.ignimgs.com/2023/04/08/sq-nswitchds-controlultimateeditioncloudversion-image500w-1680973421643.jpg"
    },
    {
        id: 1172470,
        name: "Apex Legends",
        image: "https://assets-prd.ignimgs.com/2023/02/16/apexrevelry-1676588335122.jpg"
    },
    {
        id: 914800,
        name: "Coffee Talk",
        image: "https://assets-prd.ignimgs.com/2022/11/09/coffee-talk-episode-1-button-fin-1668033710468.jpg"
    }, {
        id: 1085220,
        name: "Figment 2: Creed Valley",
        image: "https://assets-prd.ignimgs.com/2021/12/15/figment-2-button-1639602944843.jpg"
    }, {
        id: 1568400,
        name: "Sheepy: A Short Adventure",
        image: "https://assets-prd.ignimgs.com/2024/04/08/sheepy-1712557253260.jpg"
    }, {
        id: 271590,
        name: "Grand Theft Auto V",
        image: "https://assets-prd.ignimgs.com/2021/12/17/gta-5-button-2021-1639777058682.jpg"
    }, {
        id: 1086940,
        name: "Baldur's Gate 3",
        image: "https://assets-prd.ignimgs.com/2023/08/24/baldursg3-1692894717196.jpeg"
    }, {
        id: 1091500,
        name: "Cyberpunk 2077",
        image: "https://assets-prd.ignimgs.com/2020/07/16/cyberpunk-2077-button-fin-1594877291453.jpg"
    }, {
        id: 221100,
        name: "DayZ",
        image: "https://assets-prd.ignimgs.com/2021/12/20/dayz-1640044421966.jpg"
    },
]

export const useCurrentProfile = routeLoader$(async ({ sharedMap }) => {
    const res = sharedMap.get("profile") as Nestri.Users.UserRetrieveResponse.Data | null

    return res
})

export default component$(() => {
    const profile = useCurrentProfile()


    return (
        <main class="flex w-screen h-full flex-col relative">
            {profile.value && <HomeNavBar avatarUrl={profile.value.avatarUrl} discriminator={profile.value.discriminator} username={profile.value.username} />}
            <section class="max-w-[750px] w-full mx-auto flex flex-col gap-3 px-5 pt-20 pb-14 min-h-screen">
                <div class="flex flex-col gap-6 w-full py-4">
                    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <GameStoreButton />
                        <button class="w-full">
                            <div class="border-gray-400/70 w-full dark:border-gray-700/70 transition-all border-dashed duration-200 border-[2px] h-14 rounded-xl px-4 gap-2 flex items-center justify-between overflow-hidden outline-none disabled:opacity-50">
                                <span class="p-2 pl-0 text-gray-600/70 dark:text-gray-400/70 leading-none shrink truncate flex text-start items-center gap-2">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="flex-shrink-0 size-5" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M11.505 2h-1.501c-3.281 0-4.921 0-6.084.814a4.5 4.5 0 0 0-1.106 1.105C2 5.08 2 6.72 2 10s0 4.919.814 6.081a4.5 4.5 0 0 0 1.106 1.105C5.083 18 6.723 18 10.004 18h4.002c3.28 0 4.921 0 6.084-.814a4.5 4.5 0 0 0 1.105-1.105c.63-.897.772-2.08.805-4.081m-8-6h4m0 0h4m-4 0V2m0 4v4m-7 5h2m-1 3v4m-4 0h8" color="currentColor" /></svg>
                                    Add another machine
                                    <div class="select-none text-[rgb(249,134,0)] ring-1 right-2 ring-gray-400 dark:ring-0 uppercase overflow-hidden rounded-md px-2 py-1 text-xs font-medium transition-colors duration-200 ease-out  dark:text-[rgb(255,159,49)] bg-[rgb(255,244,232)] dark:bg-[rgb(49,39,28)] border-[rgb(254,231,204)] dark:border-[rgb(72,53,30)]">
                                        <span>Soon</span>
                                    </div>
                                </span>
                            </div>
                        </button>
                    </div>
                </div >
                <div class="gap-2 w-full flex-col flex">
                    <hr class="border-none h-[1.5px] dark:bg-gray-700 bg-gray-300 w-full" />
                    <div class="flex flex-col justify-center py-2 px-3 items-start w-full ">
                        <div class="text-gray-600/70 dark:text-gray-400/70 leading-none flex justify-between items-center w-full py-1">
                            <span class="text-xl text-gray-700 dark:text-gray-300 leading-none font-bold font-title flex gap-2 items-center pb-2">
                                <svg xmlns="http://www.w3.org/2000/svg" class="flex-shrink-0 size-5" viewBox="0 0 20 20"><path fill="currentColor" d="M2.049 9.112a8.001 8.001 0 1 1 9.718 8.692a1.5 1.5 0 0 0-.206-1.865l-.01-.01q.244-.355.47-.837a9.3 9.3 0 0 0 .56-1.592H9.744q.17-.478.229-1h2.82A15 15 0 0 0 13 10c0-.883-.073-1.725-.206-2.5H7.206l-.05.315a4.5 4.5 0 0 0-.971-.263l.008-.052H3.46q-.112.291-.198.595c-.462.265-.873.61-1.213 1.017m9.973-4.204C11.407 3.59 10.657 3 10 3s-1.407.59-2.022 1.908A9.3 9.3 0 0 0 7.42 6.5h5.162a9.3 9.3 0 0 0-.56-1.592M6.389 6.5c.176-.743.407-1.422.683-2.015c.186-.399.401-.773.642-1.103A7.02 7.02 0 0 0 3.936 6.5zm9.675 7H13.61a10.5 10.5 0 0 1-.683 2.015a6.6 6.6 0 0 1-.642 1.103a7.02 7.02 0 0 0 3.778-3.118m-2.257-1h2.733c.297-.776.46-1.62.46-2.5s-.163-1.724-.46-2.5h-2.733c.126.788.193 1.63.193 2.5s-.067 1.712-.193 2.5m2.257-6a7.02 7.02 0 0 0-3.778-3.118c.241.33.456.704.642 1.103c.276.593.507 1.272.683 2.015zm-7.76 7.596a3.5 3.5 0 1 0-.707.707l2.55 2.55a.5.5 0 0 0 .707-.707zM8 12a2.5 2.5 0 1 1-5 0a2.5 2.5 0 0 1 5 0" /></svg>
                                Find people to play with
                            </span>
                        </div>
                        <ul class="list-none ml-4 relative w-[calc(100%-1rem)]">
                            {new Array(3).fill(0).map((_,key) => (
                                <div key={`find-${key}`} >
                                    <div class="gap-3.5 text-left animate-pulse outline-none group rounded-lg px-3 [transition:all_0.3s_cubic-bezier(0.4,0,0.2,1)] flex items-center w-full">
                                        <div class="relative w-max">
                                            <div class="size-20 rounded-full bg-gray-800"/>
                                        </div>
                                        <div class={cn("w-full h-[100px] overflow-hidden pr-2 border-b-2 border-gray-400/70 dark:border-gray-700/70 flex gap-2 items-center", key == 2 && "border-none")}>
                                            <div class="flex-col w-[80%] gap-2 flex">
                                                <span class="font-medium tracking-tighter bg-gray-800 h-6 w-2/3 max-w-full text-lg font-title truncate leading-none block"/>
                                                <div class="flex items-center gap-2 w-full h-6 bg-gray-800"/>
                                            </div>
                                            <div class="bg-gray-800 h-7 w-16 ml-auto" />
                                        </div>
                                    </div>
                                </div>
                            ))}
                            {/* {games.slice(5, 8).sort().map((game, key) => (
                                <div key={`find-${key}`} >
                                    <div class="gap-3.5 text-left outline-none group rounded-lg px-3 [transition:all_0.3s_cubic-bezier(0.4,0,0.2,1)] flex items-center w-full">
                                        <div class="relative [&>svg]:size-[80px] w-max">
                                            {profile.value && (profile.value.avatarUrl ? (<img height={52} width={52} draggable={false} class="[transition:all_0.3s_cubic-bezier(0.4,0,0.2,1)] group-hover:scale-105 group-hover:shadow-md group-hover:shadow-gray-900 select-none rounded-full aspect-square w-[80px]" src={profile.value.avatarUrl} alt={game.name} />) : (<Avatar name={`${profile.value.username}#${profile.value.discriminator}`} />))}
                                            <div class="size-1/4 min-w-1.5 min-h-1.5 rounded-full bg-gray-100 dark:bg-gray-900 absolute right-0 bottom-0 overflow-hidden [&>svg]:size-10 flex justify-center items-center">
                                                <div style={{ "--border": "max(3px,10%)" }} class="dark:bg-[#00EE98] bg-[#1AFFD8] m-[--border]  rounded-full size-[calc(100%-2*var(--border))]" />
                                            </div>
                                        </div>
                                        <div class={cn("w-full h-[100px] overflow-hidden pr-2 border-b-2 border-gray-400/70 dark:border-gray-700/70 flex gap-2 items-center", key == 2 && "border-none")}>
                                            <div class="flex-col">
                                                <span class="font-medium tracking-tighter text-gray-700 dark:text-gray-300 max-w-full text-lg font-title truncate leading-none">
                                                    {`${profile.value.username}#${profile.value.discriminator}`}
                                                    WanjohiRyan#47
                                                </span>
                                                <div class="flex items-center gap-2 w-full cursor-pointer">
                                                    <div style={{ "--dark-bg": "#00EE98" }} class="flex w-5 items-center justify-center space-x-[1.5px] brightness-110">
                                                        <div class="ease size-0.5 max-h-5 animate-[playing_0.95s_ease_infinite] rounded-[1px] transition-all duration-500 bg-gray-800 dark:bg-[--dark-bg]" />
                                                        <div class="ease size-0.5 max-h-5 animate-[playing_1.46s_ease_infinite] rounded-[1px] transition-all duration-500 bg-gray-800 dark:bg-[--dark-bg]" />
                                                        <div class="ease size-0.5 max-h-5 animate-[playing_0.82s_ease_infinite] rounded-[1px] transition-all duration-500 bg-gray-800 dark:bg-[--dark-bg]" />
                                                        <div class="ease size-0.5 max-h-5 animate-[playing_1.24s_ease_infinite] rounded-[1px] transition-all duration-500 bg-gray-800 dark:bg-[--dark-bg]" />
                                                    </div>
                                                    <div class="font-normal w-full text-[#00EE98] truncate flex gap-1 items-center">
                                                        Playing Steam on AWS
                                                        <div class="[&>svg]:size-4" >
                                                            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 16 16"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8.25 2.75h-5.5v10.5h10.5v-5.5m0-5l-5.5 5.5m3-6.5h3.5v3.5" /></svg>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                            <button disabled class="ml-auto disabled:cursor-not-allowed disabled:opacity-50 text-gray-600 dark:text-gray-400 bg-gray-500/20 text-sm rounded-md py-2 transition-colors duration-200 ease-out px-3 hover:ring-2 hover:ring-[#8f8f8f] dark:hover:ring-[#707070] outline-none hover:bg-gray-300/70 dark:hover:bg-gray-700/70">
                                                Invite
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))} */}
                            <div class="[border:1px_dashed_theme(colors.gray.300)] dark:[border:1px_dashed_theme(colors.gray.800)] [mask-image:linear-gradient(rgb(0,0,0)_0%,_rgb(0,0,0)_calc(100%-120px),_transparent_100%)] bottom-0 top-0 -left-[0.4625rem] absolute" />
                        </ul>
                    </div>
                </div>
                <div class="gap-2 w-full flex-col flex">
                    <hr class="border-none h-[1.5px] dark:bg-gray-700 bg-gray-300 w-full" />
                    <div class="text-gray-600/70 dark:text-gray-400/70 text-sm leading-none flex justify-between py-2 px-3 items-end">
                        <span class="text-xl text-gray-700 dark:text-gray-300 leading-none font-bold font-title flex gap-2 ">
                            <svg xmlns="http://www.w3.org/2000/svg" class="flex-shrink-0 size-5" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 22c-.818 0-1.6-.33-3.163-.99C4.946 19.366 3 18.543 3 17.16V7m9 15c.818 0 1.6-.33 3.163-.99C19.054 19.366 21 18.543 21 17.16V7m-9 15V11.355M8.326 9.691L5.405 8.278C3.802 7.502 3 7.114 3 6.5s.802-1.002 2.405-1.778l2.92-1.413C10.13 2.436 11.03 2 12 2s1.871.436 3.674 1.309l2.921 1.413C20.198 5.498 21 5.886 21 6.5s-.802 1.002-2.405 1.778l-2.92 1.413C13.87 10.564 12.97 11 12 11s-1.871-.436-3.674-1.309M6 12l2 1m9-9L7 9" color="currentColor" /></svg>
                            Your Games
                        </span>
                        <button class="flex gap-1 items-center cursor-pointer hover:text-gray-800 dark:hover:text-gray-200 transition-all duration-200 outline-none">
                            <svg xmlns="http://www.w3.org/2000/svg" class="flex-shrink-0 size-5" viewBox="0 0 256 256"><path fill="currentColor" d="M248 128a87.34 87.34 0 0 1-17.6 52.81a8 8 0 1 1-12.8-9.62A71.34 71.34 0 0 0 232 128a72 72 0 0 0-144 0a8 8 0 0 1-16 0a88 88 0 0 1 3.29-23.88C74.2 104 73.1 104 72 104a48 48 0 0 0 0 96h24a8 8 0 0 1 0 16H72a64 64 0 1 1 9.29-127.32A88 88 0 0 1 248 128m-69.66 42.34L160 188.69V128a8 8 0 0 0-16 0v60.69l-18.34-18.35a8 8 0 0 0-11.32 11.32l32 32a8 8 0 0 0 11.32 0l32-32a8 8 0 0 0-11.32-11.32" /></svg>
                            <span>Install a game</span>
                        </button>
                    </div>
                    <ul class="relative py-3 w-full list-none after:pointer-events-none after:select-none after:w-full after:h-[120px] after:fixed after:z-10 after:backdrop-blur-[1px] after:bg-gradient-to-b after:from-transparent after:to-gray-200 dark:after:to-gray-800 after:[-webkit-mask-image:linear-gradient(to_top,theme(colors.gray.200)_25%,transparent)] dark:after:[-webkit-mask-image:linear-gradient(to_top,theme(colors.gray.800)_25%,transparent)] after:left-0 after:-bottom-[1px]">
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
                            <button disabled class="flex h-[48px] disabled:cursor-not-allowed disabled:opacity-50 max-w-[360px] w-full select-none items-center justify-center rounded-full bg-primary-500 text-base font-semibold text-white transition-all duration-200 ease-out disabled:hover:!ring-0 hover:ring-2 hover:ring-gray-600 dark:hover:ring-gray-400 focus:scale-95 active:scale-95 disabled:active:scale-100 disabled:focus:scale-100 sm:font-medium">Launch Steam</button>
                        </div>
                    </ul>
                </div>
            </section >
        </main >
    )
})