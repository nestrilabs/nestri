import { Avatar, GameStoreButton } from "@nestri/ui";
import { cn } from "@nestri/ui/design";
import type Nestri from "@nestri/sdk";
import { Modal } from "@qwik-ui/headless";
import { component$ } from "@builder.io/qwik";
import { routeLoader$ } from "@builder.io/qwik-city";
import { HomeNavBar, SimpleFooter } from "@nestri/ui";

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
    //     return {
    //         avatarUrl: undefined,
    //         discriminator: 47,
    //         username: "WanjohiRyan"
    //     }
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
                            <div class="border-gray-400/70 w-full dark:border-gray-700/70 transition-all border-dashed duration-200 border-[2px] h-14 rounded-xl pl-4 gap-2 flex items-center justify-between overflow-hidden outline-none disabled:opacity-50">
                                <span class="py-2 text-gray-600/70 dark:text-gray-400/70 leading-none shrink truncate flex text-start justify-center items-center gap-2">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="flex-shrink-0 size-5" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M11.505 2h-1.501c-3.281 0-4.921 0-6.084.814a4.5 4.5 0 0 0-1.106 1.105C2 5.08 2 6.72 2 10s0 4.919.814 6.081a4.5 4.5 0 0 0 1.106 1.105C5.083 18 6.723 18 10.004 18h4.002c3.28 0 4.921 0 6.084-.814a4.5 4.5 0 0 0 1.105-1.105c.63-.897.772-2.08.805-4.081m-8-6h4m0 0h4m-4 0V2m0 4v4m-7 5h2m-1 3v4m-4 0h8" color="currentColor" /></svg>
                                    Add a machine
                                    <span class="text-[rgb(249,134,0)] rounded-md border text-xs uppercase dark:text-[rgb(255,159,49)] bg-[rgb(255,244,232)] dark:bg-[rgb(49,39,28)] border-[rgb(254,231,204)] dark:border-[rgb(72,53,30)] px-1 py-0.5 leading-tight" >
                                        Soon
                                    </span>
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
                            {games.slice(5, 8).sort().map((game, key) => (
                                <Modal.Root key={`find-${key}`} >
                                    <Modal.Trigger class="gap-3.5 text-left hover:bg-gray-300/70 dark:hover:bg-gray-700/70 hover:ring-2 hover:ring-[#8f8f8f] dark:hover:ring-[#707070] outline-none group rounded-lg px-3 [transition:all_0.3s_cubic-bezier(0.4,0,0.2,1)] flex items-center w-full">
                                        <div class="relative">
                                            {profile.value && (profile.value.avatarUrl ? (<img height={52} width={52} draggable={false} class="[transition:all_0.3s_cubic-bezier(0.4,0,0.2,1)] group-hover:scale-105 group-hover:shadow-lg group-hover:shadow-gray-900 select-none rounded-full aspect-square w-[80px]" src={profile.value.avatarUrl} alt={game.name} />) : (<Avatar name={`${profile.value.username}#${profile.value.discriminator}`} />))}
                                            <div class="size-1/4 min-w-1.5 min-h-1.5 rounded-full bg-[rgb(19,21,23)] absolute right-0 bottom-0 overflow-hidden [&>svg]:size-10 flex justify-center items-center">
                                                <div style={{ "--border": "max(3px,10%)" }} class="bg-green-500 m-[--border]  rounded-full size-[calc(100%-2*var(--border))]" />
                                            </div>
                                        </div>
                                        {/* {!profile.value && <div class="[transition:all_0.3s_cubic-bezier(0.4,0,0.2,1)] group-hover:scale-105 group-hover:shadow-lg group-hover:shadow-gray-900 select-none rounded-full aspect-square w-[80px]" />} */}
                                        <div class={cn("w-full h-[100px] overflow-hidden border-b-2 border-gray-400/70 dark:border-gray-700/70 flex flex-col gap-2 justify-center", key == 2 && "border-none")}>
                                            <span class="font-medium tracking-tighter text-gray-700 dark:text-gray-300 max-w-full text-lg font-title truncate leading-none">
                                                {/* {`${profile.value.username}#${profile.value.discriminator}`} */}
                                                WanjohiRyan#47
                                            </span>
                                            <div class="flex items-center gap-2 w-full">
                                                <span class="font-normal w-full text-gray-600 dark:text-gray-400 truncate flex gap-1 items-center">
                                                    Playing Steam on AWS
                                                </span>
                                            </div>
                                        </div>
                                    </Modal.Trigger>
                                    {/* <Modal.Panel class="modal-sheet [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] dark:backdrop:bg-[#0009] backdrop:bg-[#b3b5b799] backdrop:backdrop-grayscale-[.3] rounded-xl border dark:border-[#343434] border-[#e2e2e2] right-2 top-0  mr-2 mt-2
                                        dark:[box-shadow:0_0_0_1px_rgba(255,255,255,0.08),_0_3.3px_2.7px_rgba(0,0,0,.1),0_8.3px_6.9px_rgba(0,0,0,.13),0_17px_14.2px_rgba(0,0,0,.17),0_35px_29.2px_rgba(0,0,0,.22),0px_-4px_4px_0px_rgba(0,0,0,.04)_inset] dark:bg-[#222b] 
                                        [box-shadow:0_0_0_1px_rgba(19,21,23,0.08),_0_3.3px_2.7px_rgba(0,0,0,.03),0_8.3px_6.9px_rgba(0,0,0,.04),0_17px_14.2px_rgba(0,0,0,.05),0_35px_29.2px_rgba(0,0,0,.06),0px_-4px_4px_0px_rgba(0,0,0,.07)_inset] bg-[#fffd] 
                                        backdrop-blur-lg">
                                        <div class=" min-h-[calc(100dvh-1rem)] h-[calc(100dvh-1rem)] w-[550px] relative " >
                                            <div class="sticky top-0 w-full z-10 backdrop-blur-lg dark:bg-[rgba(19,21,23,0.48)] dark:border-white/[.08] border-b py-2 px-3 min-h-12 gap-3 flex justify-between items-center" >
                                                <Modal.Close class="dark:text-white/[.64] text-[rgba(19,21,23,0.64)] [&>svg]:size-5 [&>svg]:scale-[1.2] hover:text-white dark:hover:text-[rgb(19,21,23)] py-1.5 px-2.5 rounded-lg transition-all duration-200 hover:bg-[rgba(19,21,23,0.64)] dark:hover:bg-white/[.64]">
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><g fill="none" fill-rule="evenodd"><path d="M24 0v24H0V0zM12.594 23.258l-.012.002l-.071.035l-.02.004l-.014-.004l-.071-.036q-.016-.004-.024.006l-.004.01l-.017.428l.005.02l.01.013l.104.074l.015.004l.012-.004l.104-.074l.012-.016l.004-.017l-.017-.427q-.004-.016-.016-.018m.264-.113l-.014.002l-.184.093l-.01.01l-.003.011l.018.43l.005.012l.008.008l.201.092q.019.005.029-.008l.004-.014l-.034-.614q-.005-.018-.02-.022m-.715.002a.02.02 0 0 0-.027.006l-.006.014l-.034.614q.001.018.017.024l.015-.002l.201-.093l.01-.008l.003-.011l.018-.43l-.003-.012l-.01-.01z" /><path fill="currentColor" d="M6.293 6.293a1 1 0 0 1 1.414 0l5 5a1 1 0 0 1 0 1.414l-5 5a1 1 0 0 1-1.414-1.414L10.586 12L6.293 7.707a1 1 0 0 1 0-1.414m6 0a1 1 0 0 1 1.414 0l5 5a1 1 0 0 1 0 1.414l-5 5a1 1 0 0 1-1.414-1.414L16.586 12l-4.293-4.293a1 1 0 0 1 0-1.414" /></g></svg>
                                                </Modal.Close>
                                                <div class="gap-2 flex justify-between flex-1 items-center ">
                                                    <div class="w-full flex items-center gap-2">
                                                        <button class="dark:text-white/[.64] dark:bg-white/[.08] text-[rgba(19,21,23,0.64)] bg-[rgba(19,21,23,0.04)] font-medium py-1.5 px-2.5 rounded-lg flex items-center gap-1 transition-all duration-200 [&>svg]:size-5 text-sm hover:text-white dark:hover:text-[rgb(19,21,23)] hover:bg-[rgba(19,21,23,0.64)] dark:hover:bg-white/[.64]">
                                                            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2"><path d="M14 7c0-.932 0-1.398-.152-1.765a2 2 0 0 0-1.083-1.083C12.398 4 11.932 4 11 4H8c-1.886 0-2.828 0-3.414.586S4 6.114 4 8v3c0 .932 0 1.398.152 1.765a2 2 0 0 0 1.083 1.083C5.602 14 6.068 14 7 14" /><rect width="10" height="10" x="10" y="10" rx="2" /></g></svg>
                                                            Copy link
                                                        </button>
                                                        <button class="dark:text-white/[.64] dark:bg-white/[.08] text-[rgba(19,21,23,0.64)] bg-[rgba(19,21,23,0.04)] font-medium py-1.5 px-2.5 rounded-lg flex items-center gap-1 transition-all duration-200 [&>svg]:size-5 text-sm hover:text-white dark:hover:text-[rgb(19,21,23)] hover:bg-[rgba(19,21,23,0.64)] dark:hover:bg-white/[.64]">
                                                            Game page
                                                            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M6 18L18 6m0 0H9m9 0v9" /></svg>
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                            <div class="p-4 pt-10 gap-6 flex flex-col text-white" >
                                                <div class="m-4 mb-2 relative flex items-center justify-center" >
                                                    <img src={game.image} height={280} width={280} class="rounded-xl bg-white/[.08] aspect-square size-[280px]" />
                                                </div>
                                                <div class="flex gap-2 flex-col dark:text-white text-black" >
                                                    <h1 class="text-3xl font-title font-bold tracking-tight leading-none" >{game.name}</h1>
                                                    <p class="dark:text-gray-400 text-gray-600 [display:-webkit-box] max-w-full overflow-hidden [-webkit-line-clamp:3] [-webkit-box-orient:vertical]" >
                                                        A short handcrafted pixel art platformer that follows Sheepy, an abandoned plushy brought to life. Sheepy: A Short Adventure is the first short game from MrSuicideSheep.
                                                    </p>
                                                    <div class="gap-y-1 gap-x-2 flex-wrap flex " >
                                                        <button class="[&>svg]:size-[14px] cursor-pointer hover:border-primary-500 hover:text-primary-500 border-2 border-[rgba(19,21,23,0.08)] dark:border-white/[.16] items-center inline-flex py-1 px-2 rounded-[100px] gap-0.5 text-[rgba(19,21,23,0.36)] dark:text-[hsla(0,0%,100%,.5)] text-[0.875rem] font-medium transition-all duration-200" >
                                                            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 16 16"><path fill="currentColor" fill-rule="evenodd" d="M7.238 2.634a.75.75 0 1 0-1.476-.268L5.283 5H3a.75.75 0 1 0 0 1.5h2.01l-.545 3H2A.75.75 0 1 0 2 11h2.192l-.43 2.366a.75.75 0 1 0 1.476.268L5.717 11h3.475l-.43 2.366a.75.75 0 1 0 1.476.268L10.717 11H13a.75.75 0 0 0 0-1.5h-2.01l.545-3H14A.75.75 0 0 0 14 5h-2.192l.43-2.366a.75.75 0 1 0-1.476-.268L10.283 5H6.808zM9.465 9.5l.545-3H6.535l-.545 3z" clip-rule="evenodd" /></svg>
                                                            Adventure
                                                        </button>
                                                        <button class="[&>svg]:size-[14px] cursor-pointer hover:border-primary-500 hover:text-primary-500 border-2 border-[rgba(19,21,23,0.08)] dark:border-white/[.16] items-center inline-flex py-1 px-2 rounded-[100px] gap-0.5 text-[rgba(19,21,23,0.36)] dark:text-[hsla(0,0%,100%,.5)] text-[0.875rem] font-medium transition-all duration-200" >
                                                            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 16 16"><path fill="currentColor" fill-rule="evenodd" d="M7.238 2.634a.75.75 0 1 0-1.476-.268L5.283 5H3a.75.75 0 1 0 0 1.5h2.01l-.545 3H2A.75.75 0 1 0 2 11h2.192l-.43 2.366a.75.75 0 1 0 1.476.268L5.717 11h3.475l-.43 2.366a.75.75 0 1 0 1.476.268L10.717 11H13a.75.75 0 0 0 0-1.5h-2.01l.545-3H14A.75.75 0 0 0 14 5h-2.192l.43-2.366a.75.75 0 1 0-1.476-.268L10.283 5H6.808zM9.465 9.5l.545-3H6.535l-.545 3z" clip-rule="evenodd" /></svg>
                                                            Free to play
                                                        </button>
                                                        <button class="[&>svg]:size-[14px] cursor-pointer hover:border-primary-500 hover:text-primary-500 border-2 border-[rgba(19,21,23,0.08)] dark:border-white/[.16] items-center inline-flex py-1 px-2 rounded-[100px] gap-0.5 text-[rgba(19,21,23,0.36)] dark:text-[hsla(0,0%,100%,.5)] text-[0.875rem] font-medium transition-all duration-200" >
                                                            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 16 16"><path fill="currentColor" fill-rule="evenodd" d="M7.238 2.634a.75.75 0 1 0-1.476-.268L5.283 5H3a.75.75 0 1 0 0 1.5h2.01l-.545 3H2A.75.75 0 1 0 2 11h2.192l-.43 2.366a.75.75 0 1 0 1.476.268L5.717 11h3.475l-.43 2.366a.75.75 0 1 0 1.476.268L10.717 11H13a.75.75 0 0 0 0-1.5h-2.01l.545-3H14A.75.75 0 0 0 14 5h-2.192l.43-2.366a.75.75 0 1 0-1.476-.268L10.283 5H6.808zM9.465 9.5l.545-3H6.535l-.545 3z" clip-rule="evenodd" /></svg>
                                                            Indie
                                                        </button>
                                                    </div>
                                                    <div class="py-3 px-4 overflow-hidden bg-white/[.08] dark:bg-white/[.04] border dark:border-[#343434] border-[#e2e2e2] rounded-xl [box-shadow:0_1px_4px_rgba(0,0,0,.1)] dark:[box-shadow:0_1px_4px_rgba(0,0,0,.15)]" >
                                                        <div class="dark:bg-white/[.08] bg-[rgba(19,21,23,0.04)] mx-[calc(-1rem+1px)] my-[calc(-0.75rem+1px)] mb-3 py-[calc(0.5rem-1px)] px-[calc(1rem-1px)]" >
                                                            <p class="text-sm text-[rgba(19,21,23,0.64)]  dark:text-[hsla(0,0%,100%,.79)] font-medium font-title" >Join a Nestri party</p>
                                                        </div>
                                                        <div class="gap-3 flex flex-col">
                                                            <div class=" border-b border-[rgba(19,21,23,0.08)] dark:border-white/[.08] gap-3 flex flex-col  [margin:-0.5rem_-1rem_0.25rem] [padding:0.5rem_1rem_0.75rem] ">
                                                                <div class="flex gap-3">
                                                                    <div class="size-7 mt-2 shrink-0 flex items-center justify-center" >
                                                                        <img alt="ESRN-Teen" width={40} height={40} src="https://oyster.ignimgs.com/mediawiki/apis.ign.com/ratings/b/bf/ESRB-ver2013_T.png?width=325" />
                                                                    </div>
                                                                    <div>
                                                                        <p class="font-medium font-title" >Teen [13+]</p>
                                                                        <span class="mt-[1px] text-sm leading-none text-[rgba(19,21,23,0.64)] dark:text-[hsla(0,0%,100%,.79)]" >Mild Language, Violence, Blood and Gore, Drug References</span>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <div class=" mb-1 dark:text-white w-full leading-none -my-1 py-1">
                                                                <button class="gap-3 outline-none hover:[box-shadow:0_0_0_2px_#fcfcfc,0_0_0_4px_#8f8f8f] dark:hover:[box-shadow:0_0_0_2px_#161616,0_0_0_4px_#707070] focus:[box-shadow:0_0_0_2px_#fcfcfc,0_0_0_4px_#8f8f8f] dark:focus:[box-shadow:0_0_0_2px_#161616,0_0_0_4px_#707070] [transition:all_0.3s_cubic-bezier(0.4,0,0.2,1)] font-medium font-title rounded-lg flex h-[calc(2.25rem+2*1px)] flex-col text-white w-full leading-none truncate bg-primary-500 items-center justify-center" >
                                                                    Join this party
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </Modal.Panel> */}
                                </Modal.Root>
                            ))}
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
                            <div class="relative flex items-center justify-center overflow-hidden rounded-[22px] p-[2px] before:absolute before:left-[-50%] before:top-[-50%] before:z-[-2] before:h-[200%] before:w-[200%] before:animate-[bgRotate_1.15s_linear_infinite] before:bg-[conic-gradient(from_0deg,transparent_0%,#FF4F01_10%,#FF4F01_25%,transparent_35%)] before:content-[''] after:absolute after:inset-[2px] after:z-[-1] after:content-['']" >
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
                        </div>
                    </ul>
                </div>
            </section >
            {/* <SimpleFooter /> */}
        </main >
    )
})