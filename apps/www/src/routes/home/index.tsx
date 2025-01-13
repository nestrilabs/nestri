import { Avatar } from "@nestri/ui";
// import {  } from "@qwik-ui/headless";
import { component$ } from "@builder.io/qwik";
import { HomeNavBar, Modal, SimpleFooter } from "@nestri/ui";
import { cn } from "@nestri/ui/design";

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

export default component$(() => {
    return (
        <main class="flex w-screen h-full flex-col">
            <HomeNavBar />
            <section class="max-w-[750px] w-full mx-auto flex flex-col gap-3 px-5 pt-20 pb-14 ">
                <div class="flex flex-col gap-6 w-full py-4">
                    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <button class="border-gray-400/70 dark:border-gray-700/70 hover:ring-2 hover:ring-[#8f8f8f] dark:hover:ring-[#707070] outline-none group transition-all duration-200  border-[2px]  h-14  rounded-xl  px-4  gap-2  flex  items-center  justify-between  overflow-hidden bg-white dark:bg-black hover:bg-gray-300/70 dark:hover:bg-gray-700/70 disabled:opacity-50">
                            <div class="py-2 w-2/3 flex flex-col">
                                <p class="text-text-100 shrink truncate w-full flex">DESKTOP-EUO8VSF</p>
                            </div>
                            <div
                                style={{
                                    "--cutout-avatar-percentage-visible": 0.2,
                                    "--head-margin-percentage": 0.1,
                                    "--size": "3rem"
                                }}
                                class="relative h-full flex w-1/3 justify-end">
                                <img draggable={false} alt="game" width={256} height={256} src="https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/1085660/9f2d65473912e04aea5b63378def39dc71be2485.ico" class="h-12 shadow-lg shadow-gray-900 ring-gray-400/70 ring-1 bg-black w-12 translate-y-4 rotate-[14deg] rounded-lg object-cover transition-transform sm:h-16 sm:w-16 group-hover:scale-110" />
                            </div>
                        </button>
                        <button class="border-gray-400/70 dark:border-gray-700/70 hover:ring-2 hover:ring-[#8f8f8f] dark:hover:ring-[#707070] group transition-all duration-200 border-[2px]  h-14  rounded-xl  px-4  gap-2  flex  items-center  justify-between overflow-hidden bg-white dark:bg-black hover:bg-gray-300/70 dark:hover:bg-gray-700/70 outline-none  disabled:opacity-50">
                            <div class="py-2 w-2/3 flex flex-col">
                                <p class="text-text-100 shrink truncate w-full flex">DESKTOP-TYUO8VSF</p>
                            </div>
                            <div
                                style={{
                                    "--cutout-avatar-percentage-visible": 0.2,
                                    "--head-margin-percentage": 0.1,
                                    "--size": "3rem"
                                }}
                                class="relative h-full flex w-1/3 justify-end">
                                <img draggable={false} alt="game" width={256} height={256} src="https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/578080/f962202b06de547cf47c156bdd7aaa5bf7f2cdbb.ico" class=" h-12 bg-black ring-gray-400/70 ring-1 shadow-lg shadow-gray-900 w-12 translate-y-4 mr-[calc(-1*(1-var(--cutout-avatar-percentage-visible)-var(--head-margin-percentage))*var(--size))] rotate-12 rounded-lg object-cover transition-transform sm:h-16 sm:w-16 group-hover:scale-110" />
                                <img draggable={false} alt="game" width={256} height={256} src="https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/1086940/ea19a7ce2af83c0240e775d79d3b690751a062c1.ico" class="h-12 bg-black ring-gray-400/70 ring-1 shadow-lg shadow-gray-900 w-12 translate-y-4 rotate-[14deg] rounded-lg object-cover transition-transform sm:h-16 sm:w-16 group-hover:scale-110" />
                            </div>
                        </button>
                        <button class="border-gray-400/70 dark:border-gray-700/70 hover:ring-2 hover:ring-[#8f8f8f] dark:hover:ring-[#707070] group transition-all duration-200 border-[2px]  h-14  rounded-xl  pl-4  gap-2  flex  items-center  justify-between  overflow-hidden bg-white dark:bg-black hover:bg-gray-300/70 dark:hover:bg-gray-700/70 outline-none disabled:opacity-50">
                            <div class="py-2 w-2/3 flex flex-col">
                                <p class="text-text-100 shrink truncate w-full flex">DESKTOP-aEFO8VSF</p>
                            </div>
                            <div
                                style={{
                                    "--cutout-avatar-percentage-visible": 0.2,
                                    "--head-margin-percentage": 0.1,
                                    "--size": "3rem"
                                }}
                                class="relative h-full flex w-1/3 justify-end">
                                <img draggable={false} alt="game" width={256} height={256} src="https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/2767030/bd22e45404f4ed4f3c549b575e23ce76fe03fb07.ico" class=" h-12 bg-black ring-gray-400/70 ring-1 shadow-lg shadow-gray-900 w-12 mr-[calc(-1*(1-var(--cutout-avatar-percentage-visible)-var(--head-margin-percentage))*var(--size))] translate-y-4 rotate-[10deg] rounded-lg object-cover transition-transform sm:h-16 sm:w-16 group-hover:scale-110" />
                                <img draggable={false} alt="game" width={256} height={256} src="https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/578080/f962202b06de547cf47c156bdd7aaa5bf7f2cdbb.ico" class=" h-12 bg-black ring-gray-400/70 ring-1 shadow-lg shadow-gray-900 w-12 mr-[calc(-1*(1-var(--cutout-avatar-percentage-visible)-var(--head-margin-percentage))*var(--size))] translate-y-4 rotate-[12deg] rounded-lg object-cover transition-transform sm:h-16 sm:w-16 group-hover:scale-110" />
                                <img draggable={false} alt="game" width={256} height={256} src="https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/1623730/22a20bdaa6d782f60caa45eb7b02fc2411dcd988.ico" class=" h-12 bg-black ring-gray-400/70 ring-1 shadow-lg shadow-gray-900 w-12 translate-y-4 rotate-[14deg] rounded-lg object-cover transition-transform sm:h-16 sm:w-16 group-hover:scale-110" />
                            </div>
                        </button>
                        <Modal.Root class="w-full">
                            <Modal.Trigger class="border-gray-400/70 w-full dark:border-gray-700/70 hover:ring-2 hover:ring-[#8f8f8f] dark:hover:ring-[#707070] group transition-all border-dashed duration-200 border-[2px]  h-14  rounded-xl  pl-4  gap-2  flex  items-center  justify-between  overflow-hidden  hover:bg-gray-300/70 dark:hover:bg-gray-700/70 outline-none  disabled:opacity-50">
                                <span class="py-2 text-gray-600/70 dark:text-gray-400/70 leading-none group-hover:text-black dark:group-hover:text-white shrink truncate flex text-start justify-center items-center gap-2">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="flex-shrink-0 size-5" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M11.505 2h-1.501c-3.281 0-4.921 0-6.084.814a4.5 4.5 0 0 0-1.106 1.105C2 5.08 2 6.72 2 10s0 4.919.814 6.081a4.5 4.5 0 0 0 1.106 1.105C5.083 18 6.723 18 10.004 18h4.002c3.28 0 4.921 0 6.084-.814a4.5 4.5 0 0 0 1.105-1.105c.63-.897.772-2.08.805-4.081m-8-6h4m0 0h4m-4 0V2m0 4v4m-7 5h2m-1 3v4m-4 0h8" color="currentColor" /></svg>
                                    Add another Linux machine
                                </span>
                            </Modal.Trigger>
                            <Modal.Panel class="
                            dark:backdrop:bg-[#0009] backdrop:bg-[#b3b5b799] backdrop:backdrop-grayscale-[.3] w-[340px] max-h-[75vh] rounded-xl border dark:border-[#343434] border-[#e2e2e2]
                            dark:[box-shadow:0_0_0_1px_rgba(255,255,255,0.08),_0_3.3px_2.7px_rgba(0,0,0,.1),0_8.3px_6.9px_rgba(0,0,0,.13),0_17px_14.2px_rgba(0,0,0,.17),0_35px_29.2px_rgba(0,0,0,.22),0px_-4px_4px_0px_rgba(0,0,0,.04)_inset] dark:bg-[#222b] 
                           [box-shadow:0_0_0_1px_rgba(19,21,23,0.08),_0_3.3px_2.7px_rgba(0,0,0,.03),0_8.3px_6.9px_rgba(0,0,0,.04),0_17px_14.2px_rgba(0,0,0,.05),0_35px_29.2px_rgba(0,0,0,.06),0px_-4px_4px_0px_rgba(0,0,0,.07)_inset] bg-[#fffd] 
                            backdrop-blur-lg py-4 px-5 modal" >
                                <div class="size-full flex flex-col">
                                    <div class="flex justify-between items-start ">
                                        <div class="mb-3 size-14 rounded-full text-[#939597] dark:text-[#d2d4d7] bg-[rgba(19,21,23,0.04)] dark:bg-white/[.08] flex items-center justify-center [&>svg]:size-8" >
                                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M11.505 2h-1.501c-3.281 0-4.921 0-6.084.814a4.5 4.5 0 0 0-1.106 1.105C2 5.08 2 6.72 2 10s0 4.919.814 6.081a4.5 4.5 0 0 0 1.106 1.105C5.083 18 6.723 18 10.004 18h4.002c3.28 0 4.921 0 6.084-.814a4.5 4.5 0 0 0 1.105-1.105c.63-.897.772-2.08.805-4.081m-8-6h4m0 0h4m-4 0V2m0 4v4m-7 5h2m-1 3v4m-4 0h8" color="currentColor" /></svg>
                                        </div>
                                    </div>
                                    <div class="dark:text-white text-black">
                                        <h3 class="font-semibold text-2xl tracking-tight mb-2 font-title">Add a Linux machine</h3>
                                        <div class="text-sm dark:text-white/[.79] text-[rgba(19,21,23,0.64)]" >
                                            Download and install the Nestri server from&nbsp;
                                            {/* <a href="/" tabIndex={-1} class="focus:[box-shadow:0_0_0_2px_#161616,0_0_0_4px_#707070] outline-none transition-all duration-200 text-primary-500 cursor-pointer underline underline-offset-3">this link</a> */}
                                            &nbsp;and get your machine id
                                        </div>
                                    </div>
                                    <form action="#" class="mt-3 flex flex-col gap-3" >
                                        <div class="">
                                            <label class="text-xs mb-2 relative block font-medium dark:text-white/[.79] text-[rgba(19,21,23,0.64)]" >
                                                Machine ID
                                            </label>
                                            <input placeholder="fc27f428f9ca47d4b41b707ae0c62090" class="transition-all duration-200 w-full px-2 py-3 h-10 border text-black dark:text-white dark:border-[#343434] border-[#e2e2e2] rounded-md text-sm outline-none bg-white dark:bg-[rgba(19,21,23,0.64)] leading-none [background-image:-webkit-linear-gradient(hsla(0,0%,100%,0),hsla(0,0%,100%,0))]
                                            focus:[box-shadow:0_0_0_2px_#fcfcfc,0_0_0_4px_#8f8f8f] dark:focus:[box-shadow:0_0_0_2px_#161616,0_0_0_4px_#707070]" />
                                        </div>
                                        <button class="w-full h-[calc(2.25rem+2*1px)] transition-all duration-200 hover:[box-shadow:0_0_0_2px_#fcfcfc,0_0_0_4px_#8f8f8f] dark:hover:[box-shadow:0_0_0_2px_#161616,0_0_0_4px_#707070] focus:[box-shadow:0_0_0_2px_#fcfcfc,0_0_0_4px_#8f8f8f] dark:focus:[box-shadow:0_0_0_2px_#161616,0_0_0_4px_#707070] outline-none bg-primary-500 text-white rounded-lg text-sm" >Add machine</button>
                                    </form>
                                </div>
                            </Modal.Panel>
                        </Modal.Root>
                    </div>
                </div>
                <div class="gap-2 w-full flex-col flex">
                    <hr class="border-none h-[1.5px] dark:bg-gray-700 bg-gray-300 w-full" />
                    <div class="flex flex-col justify-center py-2 px-3 items-start w-full ">
                        <div class="text-gray-600/70 dark:text-gray-400/70 text-sm leading-none flex justify-between items-center w-full py-1">
                            <span class="text-xl text-gray-700 dark:text-gray-300 leading-none font-bold font-title flex gap-2 items-center pb-2">
                                <svg xmlns="http://www.w3.org/2000/svg" class="flex-shrink-0 size-5" viewBox="0 0 20 20"><path fill="currentColor" d="M2.049 9.112a8.001 8.001 0 1 1 9.718 8.692a1.5 1.5 0 0 0-.206-1.865l-.01-.01q.244-.355.47-.837a9.3 9.3 0 0 0 .56-1.592H9.744q.17-.478.229-1h2.82A15 15 0 0 0 13 10c0-.883-.073-1.725-.206-2.5H7.206l-.05.315a4.5 4.5 0 0 0-.971-.263l.008-.052H3.46q-.112.291-.198.595c-.462.265-.873.61-1.213 1.017m9.973-4.204C11.407 3.59 10.657 3 10 3s-1.407.59-2.022 1.908A9.3 9.3 0 0 0 7.42 6.5h5.162a9.3 9.3 0 0 0-.56-1.592M6.389 6.5c.176-.743.407-1.422.683-2.015c.186-.399.401-.773.642-1.103A7.02 7.02 0 0 0 3.936 6.5zm9.675 7H13.61a10.5 10.5 0 0 1-.683 2.015a6.6 6.6 0 0 1-.642 1.103a7.02 7.02 0 0 0 3.778-3.118m-2.257-1h2.733c.297-.776.46-1.62.46-2.5s-.163-1.724-.46-2.5h-2.733c.126.788.193 1.63.193 2.5s-.067 1.712-.193 2.5m2.257-6a7.02 7.02 0 0 0-3.778-3.118c.241.33.456.704.642 1.103c.276.593.507 1.272.683 2.015zm-7.76 7.596a3.5 3.5 0 1 0-.707.707l2.55 2.55a.5.5 0 0 0 .707-.707zM8 12a2.5 2.5 0 1 1-5 0a2.5 2.5 0 0 1 5 0" /></svg>
                                Find people to play with
                            </span>
                        </div>
                        <ul class="list-none ml-4 relative w-[calc(100%-1rem)]">
                            {games.slice(5, 8).sort().map((game, key) => (
                                <Modal.Root key={`find-${key}`} >
                                    <Modal.Trigger class="gap-3.5 text-left hover:bg-gray-300/70 dark:hover:bg-gray-700/70 hover:ring-2 hover:ring-[#8f8f8f] dark:hover:ring-[#707070] outline-none group rounded-lg px-3 [transition:all_0.3s_cubic-bezier(0.4,0,0.2,1)] flex items-center w-full">
                                        <img height={52} width={52} draggable={false} class="[transition:all_0.3s_cubic-bezier(0.4,0,0.2,1)] group-hover:scale-105 group-hover:shadow-lg group-hover:shadow-gray-900 select-none rounded-lg aspect-square w-[80px]" src={game.image} alt={game.name} />
                                        <div class={cn("w-full h-[100px] overflow-hidden border-b-2 border-gray-400/70 dark:border-gray-700/70 flex flex-col gap-2 justify-center", key == 2 && "border-none")}>
                                            <span class="font-medium tracking-tighter text-gray-700 dark:text-gray-300 max-w-full text-lg font-title truncate leading-none">
                                                {game.name}
                                            </span>
                                            <div class="flex items-center px-2 gap-2 w-full">
                                                <div
                                                    class="items-center flex"
                                                    style={{
                                                        "--size": "1.25rem",
                                                        "--cutout-avatar-percentage-visible": 0.4,
                                                        "--head-margin-percentage": 0.2
                                                    }}>
                                                    {new Array(3).fill(0).map((_, key) => (
                                                        <div key={key} class="relative items-start flex ml-[calc(-1*(1-var(--cutout-avatar-percentage-visible)-var(--head-margin-percentage))*var(--size))]">
                                                            <div
                                                                class="[&>svg]:size-5"
                                                                style={{
                                                                    maskSize: "100% 100%",
                                                                    maskRepeat: "no-repeat",
                                                                    maskPosition: "center",
                                                                    maskComposite: "subtract",
                                                                    maskImage: `url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><circle r="0.5" cx="0.5" cy="0.5"/></svg>'),url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><circle r="0.6" cx="1.1" cy="0.5"/></svg>')`
                                                                }}
                                                            >
                                                                <Avatar name={((key + 1) * Math.floor(100 * Math.random())).toString()} />
                                                            </div>
                                                        </div>
                                                    ))}
                                                    <div class="[&>svg]:size-[--size] ml-[calc(-1*(1-var(--cutout-avatar-percentage-visible)-var(--head-margin-percentage))*var(--size))] relative flex items-center justify-center">
                                                        <Avatar name={(key * Math.floor(100 * Math.random())).toString()} />
                                                    </div>
                                                </div>
                                                <p class="font-normal text-gray-600 dark:text-gray-400 text-sm w-full truncate">{`${Math.floor(Math.random() * 100)} people are currently playing this game`}</p>
                                            </div>
                                        </div>
                                    </Modal.Trigger>
                                    <Modal.Panel class="modal-sheet [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] dark:backdrop:bg-[#0009] backdrop:bg-[#b3b5b799] backdrop:backdrop-grayscale-[.3] rounded-xl border dark:border-[#343434] border-[#e2e2e2] right-2 top-0  mr-2 mt-2
                                        dark:[box-shadow:0_0_0_1px_rgba(255,255,255,0.08),_0_3.3px_2.7px_rgba(0,0,0,.1),0_8.3px_6.9px_rgba(0,0,0,.13),0_17px_14.2px_rgba(0,0,0,.17),0_35px_29.2px_rgba(0,0,0,.22),0px_-4px_4px_0px_rgba(0,0,0,.04)_inset] dark:bg-[#222b] 
                                        [box-shadow:0_0_0_1px_rgba(19,21,23,0.08),_0_3.3px_2.7px_rgba(0,0,0,.03),0_8.3px_6.9px_rgba(0,0,0,.04),0_17px_14.2px_rgba(0,0,0,.05),0_35px_29.2px_rgba(0,0,0,.06),0px_-4px_4px_0px_rgba(0,0,0,.07)_inset] bg-[#fffd] 
                                        backdrop-blur-lg">
                                        <div class=" min-h-[calc(100dvh-1rem)] h-[calc(100dvh-1rem)] w-[550px] relative " >
                                            <div class="sticky top-0 w-full z-10 backdrop-blur-lg dark:bg-[rgba(19,21,23,0.48)] dark:border-white/[.08] border-b py-2 px-3 min-h-12 gap-3 flex justify-between items-center" >
                                                <Modal.Close class="text-white/[.64] [&>svg]:size-5 [&>svg]:scale-[1.2] hover:text-[rgb(19,21,23)] py-1.5 px-2.5 rounded-lg transition-all duration-200 hover:bg-white/[.64]">
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><g fill="none" fill-rule="evenodd"><path d="M24 0v24H0V0zM12.594 23.258l-.012.002l-.071.035l-.02.004l-.014-.004l-.071-.036q-.016-.004-.024.006l-.004.01l-.017.428l.005.02l.01.013l.104.074l.015.004l.012-.004l.104-.074l.012-.016l.004-.017l-.017-.427q-.004-.016-.016-.018m.264-.113l-.014.002l-.184.093l-.01.01l-.003.011l.018.43l.005.012l.008.008l.201.092q.019.005.029-.008l.004-.014l-.034-.614q-.005-.018-.02-.022m-.715.002a.02.02 0 0 0-.027.006l-.006.014l-.034.614q.001.018.017.024l.015-.002l.201-.093l.01-.008l.003-.011l.018-.43l-.003-.012l-.01-.01z" /><path fill="currentColor" d="M6.293 6.293a1 1 0 0 1 1.414 0l5 5a1 1 0 0 1 0 1.414l-5 5a1 1 0 0 1-1.414-1.414L10.586 12L6.293 7.707a1 1 0 0 1 0-1.414m6 0a1 1 0 0 1 1.414 0l5 5a1 1 0 0 1 0 1.414l-5 5a1 1 0 0 1-1.414-1.414L16.586 12l-4.293-4.293a1 1 0 0 1 0-1.414" /></g></svg>
                                                </Modal.Close>
                                                <div class="gap-2 flex justify-between flex-1 items-center ">
                                                    <div class="w-full flex items-center gap-2">
                                                        <button class="text-white/[.64] bg-white/[.08] font-medium py-1.5 px-2.5 rounded-lg flex items-center gap-1 transition-all duration-200 [&>svg]:size-5 text-sm hover:text-[rgb(19,21,23)] hover:bg-white/[.64]">
                                                            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="2"><path d="M14 7c0-.932 0-1.398-.152-1.765a2 2 0 0 0-1.083-1.083C12.398 4 11.932 4 11 4H8c-1.886 0-2.828 0-3.414.586S4 6.114 4 8v3c0 .932 0 1.398.152 1.765a2 2 0 0 0 1.083 1.083C5.602 14 6.068 14 7 14" /><rect width="10" height="10" x="10" y="10" rx="2" /></g></svg>
                                                            Copy link
                                                        </button>
                                                        <button class="text-white/[.64] bg-white/[.08] py-1.5 px-2.5 rounded-lg flex items-center gap-2 transition-all duration-200 [&>svg]:size-4 text-sm hover:text-[rgb(19,21,23)] hover:bg-white/[.64]">
                                                            Game page
                                                            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M6 18L18 6m0 0H9m9 0v9" /></svg>
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                            <div class="p-4 gap-6 flex flex-col text-white" >
                                                <div class="m-4 mb-2 relative flex items-center justify-center" >
                                                    <img src={game.image} height={280} width={280} class="rounded-xl bg-white/[.08] aspect-square size-[280px]" />
                                                </div>
                                                <div class="flex gap-2 flex-col text-white" >
                                                    <h1 class="text-3xl font-title font-bold tracking-tight leading-none" >{game.name}</h1>
                                                    <p class="text-gray-400 [display:-webkit-box] max-w-full overflow-hidden [-webkit-line-clamp:3] [-webkit-box-orient:vertical]" >
                                                        A short handcrafted pixel art platformer that follows Sheepy, an abandoned plushy brought to life. Sheepy: A Short Adventure is the first short game from MrSuicideSheep.
                                                    </p>
                                                    <div class="gap-y-1 gap-x-2 flex-wrap flex " >
                                                        <button class="[&>svg]:size-[14px] cursor-pointer hover:border-primary-500 hover:text-primary-500 border-2 border-white/[.16] items-center inline-flex py-1 px-2 rounded-[100px] gap-0.5 text-[hsla(0,0%,100%,.5)] text-[0.875rem] font-medium transition-all duration-200" >
                                                            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 16 16"><path fill="currentColor" fill-rule="evenodd" d="M7.238 2.634a.75.75 0 1 0-1.476-.268L5.283 5H3a.75.75 0 1 0 0 1.5h2.01l-.545 3H2A.75.75 0 1 0 2 11h2.192l-.43 2.366a.75.75 0 1 0 1.476.268L5.717 11h3.475l-.43 2.366a.75.75 0 1 0 1.476.268L10.717 11H13a.75.75 0 0 0 0-1.5h-2.01l.545-3H14A.75.75 0 0 0 14 5h-2.192l.43-2.366a.75.75 0 1 0-1.476-.268L10.283 5H6.808zM9.465 9.5l.545-3H6.535l-.545 3z" clip-rule="evenodd" /></svg>
                                                            Adventure
                                                        </button>
                                                        <button class="[&>svg]:size-[14px] cursor-pointer hover:border-primary-500 hover:text-primary-500 border-2 border-white/[.16] items-center inline-flex py-1 px-2 rounded-[100px] gap-0.5 text-[hsla(0,0%,100%,.5)] text-[0.875rem] font-medium transition-all duration-200" >
                                                            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 16 16"><path fill="currentColor" fill-rule="evenodd" d="M7.238 2.634a.75.75 0 1 0-1.476-.268L5.283 5H3a.75.75 0 1 0 0 1.5h2.01l-.545 3H2A.75.75 0 1 0 2 11h2.192l-.43 2.366a.75.75 0 1 0 1.476.268L5.717 11h3.475l-.43 2.366a.75.75 0 1 0 1.476.268L10.717 11H13a.75.75 0 0 0 0-1.5h-2.01l.545-3H14A.75.75 0 0 0 14 5h-2.192l.43-2.366a.75.75 0 1 0-1.476-.268L10.283 5H6.808zM9.465 9.5l.545-3H6.535l-.545 3z" clip-rule="evenodd" /></svg>
                                                            Free to play
                                                        </button><button class="[&>svg]:size-[14px] cursor-pointer hover:border-primary-500 hover:text-primary-500 border-2 border-white/[.16] items-center inline-flex py-1 px-2 rounded-[100px] gap-0.5 text-[hsla(0,0%,100%,.5)] text-[0.875rem] font-medium transition-all duration-200" >
                                                            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 16 16"><path fill="currentColor" fill-rule="evenodd" d="M7.238 2.634a.75.75 0 1 0-1.476-.268L5.283 5H3a.75.75 0 1 0 0 1.5h2.01l-.545 3H2A.75.75 0 1 0 2 11h2.192l-.43 2.366a.75.75 0 1 0 1.476.268L5.717 11h3.475l-.43 2.366a.75.75 0 1 0 1.476.268L10.717 11H13a.75.75 0 0 0 0-1.5h-2.01l.545-3H14A.75.75 0 0 0 14 5h-2.192l.43-2.366a.75.75 0 1 0-1.476-.268L10.283 5H6.808zM9.465 9.5l.545-3H6.535l-.545 3z" clip-rule="evenodd" /></svg>
                                                            Indie
                                                        </button>
                                                    </div>
                                                    <div class="py-3 px-4 overflow-hidden bg-white/[.04] border dark:border-[#343434] border-[#e2e2e2] rounded-xl [box-shadow:0_1px_4px_rgba(0,0,0,.15)]" >
                                                        <div class="bg-white/[.08] mx-[calc(-1rem+1px)] my-[calc(-0.75rem+1px)] mb-3 py-[calc(0.5rem-1px)] px-[calc(1rem-1px)]" >
                                                            <p class="text-sm text-[hsla(0,0%,100%,.79)] font-medium font-title" >Start a party</p>
                                                        </div>
                                                        <div class="gap-3 flex flex-col">
                                                            <div class=" border-b border-white/[.08] gap-3 flex flex-col  [margin:-0.5rem_-1rem_0.25rem] [padding:0.5rem_1rem_0.75rem] ">
                                                                <div class="flex gap-3">
                                                                    <div class="size-7 mt-2 shrink-0 flex items-center justify-center" >
                                                                        <img alt="ESRN-Teen" width={40} height={40} src="https://oyster.ignimgs.com/mediawiki/apis.ign.com/ratings/b/bf/ESRB-ver2013_T.png?width=325" />
                                                                    </div>
                                                                    <div>
                                                                        <p class="font-medium font-title" >Teen [13+]</p>
                                                                        <span class="mt-[1px] text-sm leading-none text-[hsla(0,0%,100%,.79)]" >Mild Language, Violence, Blood and Gore, Drug References</span>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            {/* <div >
                                                            Hello! To start a party with this game, press the button below.
                                                        </div> */}
                                                            <div class=" mb-1 text-white w-full leading-none -my-1 py-1">
                                                                <button class="gap-3 outline-none hover:[box-shadow:0_0_0_2px_#fcfcfc,0_0_0_4px_#8f8f8f] dark:hover:[box-shadow:0_0_0_2px_#161616,0_0_0_4px_#707070] focus:[box-shadow:0_0_0_2px_#fcfcfc,0_0_0_4px_#8f8f8f] dark:focus:[box-shadow:0_0_0_2px_#161616,0_0_0_4px_#707070] [transition:all_0.3s_cubic-bezier(0.4,0,0.2,1)] font-medium font-title rounded-lg flex h-[calc(2.25rem+2*1px)] flex-col text-white w-full leading-none truncate bg-primary-500 items-center justify-center" >
                                                                    Start a party
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </Modal.Panel>
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
                    <ul class="relative py-3 w-full grid sm:grid-cols-3 grid-cols-2 list-none after:pointer-events-none after:select-none after:w-full after:h-[120px] after:fixed after:z-10 after:backdrop-blur-[1px] after:bg-gradient-to-b after:from-transparent after:to-gray-100 dark:after:to-gray-900 after:[-webkit-mask-image:linear-gradient(to_top,theme(colors.gray.100)_25%,transparent)] dark:after:[-webkit-mask-image:linear-gradient(to_top,theme(colors.gray.900)_25%,transparent)]  after:[-webkit-backdrop-filter:1px] after:left-0 after:-bottom-[1px]">
                        {games.map((game, key) => (
                            <Modal.Root key={`game-${key}`} >
                                <Modal.Trigger class="hover:bg-gray-300/70 dark:hover:bg-gray-700/70 [transition:all_0.3s_cubic-bezier(0.4,0,0.2,1)] px-2 py-2 rounded-[15px] hover:ring-2 hover:ring-[#8f8f8f] dark:hover:ring-[#707070] outline-none size-full group [&_*]:transition-all [&_*]:duration-150 flex flex-col gap-2" key={key}>
                                    <img draggable={false} alt={game.name} class="select-none [transition:all_0.3s_cubic-bezier(0.4,0,0.2,1)] group-hover:scale-[1.01] group-hover:shadow-lg group-hover:shadow-gray-900 w-full rounded-xl aspect-square" src={game.image} height={90} width={90} />
                                    <div class="flex flex-col px-2 w-full">
                                        <span class="max-w-full truncate">{game.name}</span>
                                    </div>
                                </Modal.Trigger>
                                <Modal.Panel class="dark:backdrop:bg-[#0009] backdrop:bg-[#b3b5b799] backdrop:backdrop-grayscale-[.3] rounded-xl border dark:border-[#343434] border-[#e2e2e2]
                                            dark:[box-shadow:0_0_0_1px_rgba(255,255,255,0.08),_0_3.3px_2.7px_rgba(0,0,0,.1),0_8.3px_6.9px_rgba(0,0,0,.13),0_17px_14.2px_rgba(0,0,0,.17),0_35px_29.2px_rgba(0,0,0,.22),0px_-4px_4px_0px_rgba(0,0,0,.04)_inset] dark:bg-[rgb(22,22,22)] 
                                            box-shadow:0_0_0_1px_rgba(19,21,23,0.08),_0_3.3px_2.7px_rgba(0,0,0,.03),0_8.3px_6.9px_rgba(0,0,0,.04),0_17px_14.2px_rgba(0,0,0,.05),0_35px_29.2px_rgba(0,0,0,.06),0px_-4px_4px_0px_rgba(0,0,0,.07)_inset] bg-[#fffd] 
                                            backdrop-blur-lg modal" >
                                    <div class="flex flex-col min-w-[17rem] relative text-white/70 w-full max-w-[41.8125rem] min-h-[min(90%,100%-3rem)]" >
                                        <div class="flex-1 relative w-full " >
                                            <div class="relative w-full pb-[56.25%] overflow-hidden after:z-[2] after:absolute after:inset-0 after:[background:linear-gradient(40deg,rgb(22,22,22)_24.16%,rgba(6,10,23,0)_56.61%),linear-gradient(0deg,rgb(22,22,22)_3.91%,rgba(6,10,23,0)_69.26%)]" >
                                                <div
                                                    style={{
                                                        backgroundImage: `url(https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${game.id}/library_hero.jpg)`
                                                    }}
                                                    class={cn("absolute inset-0 z-[1] [transition:opacity_300ms_ease-in-out] bg-cover bg-[center_top] bg-no-repeat")} />
                                                <div
                                                    style={{
                                                        backgroundImage: `url(${game.image})`
                                                    }}
                                                    class={cn("absolute inset-0 -z-[1] bg-cover bg-[center_top] bg-no-repeat blur-[4rem]")} />
                                                <div
                                                    style={{
                                                        backgroundImage: `url(https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${game.id}/logo.png)`
                                                    }}
                                                    class="absolute bottom-0 min-[600px]:left-10 left-4 bg-contain bg-[center_bottom] bg-no-repeat  min-[600px]:max-w-[40%] w-full aspect-video z-[3] " />
                                            </div>
                                            <div class="min-[600px]:p-10 min-[600px]:pt-4 pt-4 px-4 pb-6" >
                                                <ul class="[&_svg]:-mt-[2px] xl:mb-3 min-[960px]:mb-2 min-[600px]:leading-5 mb-4 leading-[0.625rem] list-none flex w-full" >
                                                    <li class="mr-2 flex gap-0.5 [&>svg]:size-[14px] items-center text-sm bg-[rgb(65,65,65)] px-2 py-1 w-max rounded-md" >
                                                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 16 16"><path fill="currentColor" fill-rule="evenodd" d="M7.238 2.634a.75.75 0 1 0-1.476-.268L5.283 5H3a.75.75 0 1 0 0 1.5h2.01l-.545 3H2A.75.75 0 1 0 2 11h2.192l-.43 2.366a.75.75 0 1 0 1.476.268L5.717 11h3.475l-.43 2.366a.75.75 0 1 0 1.476.268L10.717 11H13a.75.75 0 0 0 0-1.5h-2.01l.545-3H14A.75.75 0 0 0 14 5h-2.192l.43-2.366a.75.75 0 1 0-1.476-.268L10.283 5H6.808zM9.465 9.5l.545-3H6.535l-.545 3z" clip-rule="evenodd" /></svg>
                                                        Shooter
                                                    </li>
                                                    <li class="mr-2 flex gap-0.5 [&>svg]:size-[14px] items-center text-sm bg-[rgb(65,65,65)] px-2 py-1 w-max rounded-md" >
                                                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 16 16"><path fill="currentColor" fill-rule="evenodd" d="M7.238 2.634a.75.75 0 1 0-1.476-.268L5.283 5H3a.75.75 0 1 0 0 1.5h2.01l-.545 3H2A.75.75 0 1 0 2 11h2.192l-.43 2.366a.75.75 0 1 0 1.476.268L5.717 11h3.475l-.43 2.366a.75.75 0 1 0 1.476.268L10.717 11H13a.75.75 0 0 0 0-1.5h-2.01l.545-3H14A.75.75 0 0 0 14 5h-2.192l.43-2.366a.75.75 0 1 0-1.476-.268L10.283 5H6.808zM9.465 9.5l.545-3H6.535l-.545 3z" clip-rule="evenodd" /></svg>
                                                        Action
                                                    </li>
                                                    <li class="mr-2 flex gap-0.5 [&>svg]:size-[14px] items-center text-sm bg-[rgb(65,65,65)] px-2 py-1 w-max rounded-md" >
                                                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 16 16"><path fill="currentColor" fill-rule="evenodd" d="M7.238 2.634a.75.75 0 1 0-1.476-.268L5.283 5H3a.75.75 0 1 0 0 1.5h2.01l-.545 3H2A.75.75 0 1 0 2 11h2.192l-.43 2.366a.75.75 0 1 0 1.476.268L5.717 11h3.475l-.43 2.366a.75.75 0 1 0 1.476.268L10.717 11H13a.75.75 0 0 0 0-1.5h-2.01l.545-3H14A.75.75 0 0 0 14 5h-2.192l.43-2.366a.75.75 0 1 0-1.476-.268L10.283 5H6.808zM9.465 9.5l.545-3H6.535l-.545 3z" clip-rule="evenodd" /></svg>
                                                        Free to play
                                                    </li>
                                                </ul>
                                                <p class="text-white/90 tracking-tight" >
                                                    Delta Force is a first-person shooter which offers players both a single player campaign based on the movie Black Hawk Down, but also large-scale PvP multiplayer action. The game was formerly known as Delta Force: Hawk Ops.
                                                </p>
                                                <div class="sm:pt-10 sm:block hidden" >
                                                    <button class="gap-3 outline-none hover:[box-shadow:0_0_0_2px_#fcfcfc,0_0_0_4px_#8f8f8f] dark:hover:[box-shadow:0_0_0_2px_#161616,0_0_0_4px_#707070] focus:[box-shadow:0_0_0_2px_#fcfcfc,0_0_0_4px_#8f8f8f] dark:focus:[box-shadow:0_0_0_2px_#161616,0_0_0_4px_#707070] [transition:all_0.3s_cubic-bezier(0.4,0,0.2,1)] font-medium font-title rounded-lg flex h-[calc(2.25rem+2*1px)] flex-col text-white w-full leading-none truncate bg-primary-500 items-center justify-center" >
                                                        Play Now
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </Modal.Panel>
                            </Modal.Root>
                        ))}
                    </ul>
                </div>
            </section>
            <SimpleFooter />
        </main >
    )
})