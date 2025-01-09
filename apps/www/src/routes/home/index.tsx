import { component$ } from "@builder.io/qwik";
import { HomeNavBar } from "@nestri/ui";
import Avatar from "../../../../../packages/ui/src/avatar";

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
            <section class="max-w-[750px] w-full mx-auto flex flex-col gap-3 px-5 py-20 ">
                <div class="flex flex-col gap-6 w-full py-4">
                    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <button class="border-gray-700/70 hover:ring-2 hover:ring-[#707070] outline-none group transition-all duration-200  border-[0.5px]  h-14  rounded-xl  px-4  gap-2  flex  items-center  justify-between  overflow-hidden  hover:bg-gray-700/70 disabled:opacity-50">
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
                                <img draggable={false} alt="game" width={256} height={256} src="https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/1085660/9f2d65473912e04aea5b63378def39dc71be2485.ico" class="h-12 bg-black w-12 translate-y-4 rotate-[14deg] rounded-lg object-cover transition-transform sm:h-16 sm:w-16 group-hover:scale-110" />
                            </div>
                        </button>
                        <button class="border-gray-700/70 group transition-all duration-200 border-[0.5px]  h-14  rounded-xl  px-4  gap-2  flex  items-center  justify-between  overflow-hidden  hover:bg-gray-700/70  hover:ring-2  hover:ring-[#707070] outline-none  disabled:opacity-50">
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
                                <img draggable={false} alt="game" width={256} height={256} src="https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/578080/f962202b06de547cf47c156bdd7aaa5bf7f2cdbb.ico" class=" h-12 bg-black w-12 translate-y-4 mr-[calc(-1*(1-var(--cutout-avatar-percentage-visible)-var(--head-margin-percentage))*var(--size))] rotate-12 rounded-lg object-cover transition-transform sm:h-16 sm:w-16 group-hover:scale-110" />
                                <img draggable={false} alt="game" width={256} height={256} src="https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/1086940/ea19a7ce2af83c0240e775d79d3b690751a062c1.ico" class="h-12 bg-black w-12 translate-y-4 rotate-[14deg] rounded-lg object-cover transition-transform sm:h-16 sm:w-16 group-hover:scale-110" />
                            </div>
                        </button>
                        <button class="border-gray-700/70 group transition-all duration-200 border-[0.5px]  h-14  rounded-xl  pl-4  gap-2  flex  items-center  justify-between  overflow-hidden hover:bg-gray-700/70  hover:ring-2 hover:ring-[#707070] outline-none disabled:opacity-50">
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
                                <img draggable={false} alt="game" width={256} height={256} src="https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/2767030/bd22e45404f4ed4f3c549b575e23ce76fe03fb07.ico" class=" h-12 bg-black w-12 mr-[calc(-1*(1-var(--cutout-avatar-percentage-visible)-var(--head-margin-percentage))*var(--size))] translate-y-4 rotate-[10deg] rounded-lg object-cover transition-transform sm:h-16 sm:w-16 group-hover:scale-110" />
                                <img draggable={false} alt="game" width={256} height={256} src="https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/578080/f962202b06de547cf47c156bdd7aaa5bf7f2cdbb.ico" class=" h-12 bg-black w-12 mr-[calc(-1*(1-var(--cutout-avatar-percentage-visible)-var(--head-margin-percentage))*var(--size))] translate-y-4 rotate-[12deg] rounded-lg object-cover transition-transform sm:h-16 sm:w-16 group-hover:scale-110" />
                                <img draggable={false} alt="game" width={256} height={256} src="https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/1623730/22a20bdaa6d782f60caa45eb7b02fc2411dcd988.ico" class=" h-12 bg-black w-12 translate-y-4 rotate-[14deg] rounded-lg object-cover transition-transform sm:h-16 sm:w-16 group-hover:scale-110" />
                            </div>
                        </button>
                        <button class="border-gray-700/70 group transition-all border-dashed duration-200 border-[0.5px]  h-14  rounded-xl  pl-4  gap-2  flex  items-center  justify-between  overflow-hidden  hover:bg-gray-700/70 hover:ring-2 hover:ring-[#707070] outline-none  disabled:opacity-50">
                            <span class="py-2  text-gray-400/70 leading-none group-hover:text-white shrink truncate flex text-start justify-center items-center gap-2">
                                <svg xmlns="http://www.w3.org/2000/svg" class="flex-shrink-0 size-5" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M11.505 2h-1.501c-3.281 0-4.921 0-6.084.814a4.5 4.5 0 0 0-1.106 1.105C2 5.08 2 6.72 2 10s0 4.919.814 6.081a4.5 4.5 0 0 0 1.106 1.105C5.083 18 6.723 18 10.004 18h4.002c3.28 0 4.921 0 6.084-.814a4.5 4.5 0 0 0 1.105-1.105c.63-.897.772-2.08.805-4.081m-8-6h4m0 0h4m-4 0V2m0 4v4m-7 5h2m-1 3v4m-4 0h8" color="currentColor" /></svg>
                                Add another Linux machine
                            </span>
                        </button>
                    </div>
                </div>
                <div class="gap-2 w-full flex-col flex">
                    <hr class="border-none h-[1.5px] bg-gray-700 w-full" />
                    <div class="flex flex-col justify-center py-2 px-3 items-start">
                        <span class="text-lg text-gray-400/70 leading-none font-title flex gap-2 items-center pb-2">
                            <svg xmlns="http://www.w3.org/2000/svg" class="flex-shrink-0 size-5" viewBox="0 0 24 24"><path fill="currentColor" d="m12 12.9l-2.13 2.09c-.56.56-.87 1.29-.87 2.07C9 18.68 10.35 20 12 20s3-1.32 3-2.94c0-.78-.31-1.52-.87-2.07z" class="duoicon-primary-layer" /><path fill="currentColor" d="m16 6l-.44.55C14.38 8.02 12 7.19 12 5.3V2S4 6 4 13c0 2.92 1.56 5.47 3.89 6.86c-.56-.79-.89-1.76-.89-2.8c0-1.32.52-2.56 1.47-3.5L12 10.1l3.53 3.47c.95.93 1.47 2.17 1.47 3.5c0 1.02-.31 1.96-.85 2.75c1.89-1.15 3.29-3.06 3.71-5.3c.66-3.55-1.07-6.9-3.86-8.52" class="duoicon-secondary-layer" opacity=".3" /></svg>
                            Find people to play with
                        </span>
                        <div class="w-full ml-4 relative">
                            <div class="gap-3.5 group rounded-lg px-3 [transition:all_0.3s_cubic-bezier(0.4,0,0.2,1)] flex items-center w-full">
                                <img height={52} width={52} draggable={false} class="select-none rounded-lg aspect-square w-[80px]" src={games[0].image} alt={games[0].name} />
                                <div class="w-full h-[100px] border-b border-gray-700/70 flex group-[:nth-last-child(2)]:border-none flex-col gap-2 justify-center">
                                    <span class="font-normal text-white max-w-full text-lg font-title truncate leading-none">
                                        {games[0].name}
                                    </span>
                                    <div class="flex items-center px-2 gap-2">
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
                                                        <Avatar name={(key * 100).toString()} />
                                                    </div>
                                                </div>
                                            ))}
                                            <div class="ml-[calc(-1*(1-var(--cutout-avatar-percentage-visible)-var(--head-margin-percentage))*var(--size))] rounded-[--size] h-[--size] min-w-[--size] bg-white/[.08] text-[calc(var(--size)/2)] px-[calc(var(--size)/6)] relative flex items-center justify-center text-gray-400">
                                                + 4
                                            </div>
                                        </div>
                                        <p class="font-normal text-gray-400/70 text-sm">Have open parties you can join</p>
                                    </div>
                                </div>
                            </div>
                            <div class="gap-3.5 group rounded-lg px-3 [transition:all_0.3s_cubic-bezier(0.4,0,0.2,1)] flex items-center w-full">
                                <img height={52} width={52} draggable={false} class="select-none rounded-lg aspect-square w-[80px]" src={games[1].image} alt={games[1].name} />
                                <div class="w-full h-[100px] border-b border-gray-700/70 flex group-[:nth-last-child(2)]:border-none flex-col gap-2 justify-center">
                                    <span class="font-normal text-white max-w-full text-lg font-title truncate leading-none">
                                        {games[1].name}
                                    </span>
                                    <div class="flex items-center px-2 gap-2">
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
                                                        <Avatar name={(key * 10000).toString()} />
                                                    </div>
                                                </div>
                                            ))}
                                            <div class="ml-[calc(-1*(1-var(--cutout-avatar-percentage-visible)-var(--head-margin-percentage))*var(--size))] rounded-[--size] h-[--size] min-w-[--size] bg-white/[.08] text-[calc(var(--size)/2)] px-[calc(var(--size)/6)] relative flex items-center justify-center text-gray-400">
                                                + 6
                                            </div>
                                        </div>
                                        <p class="font-normal text-gray-400/70 text-sm">Have open parties you can join</p>
                                    </div>
                                </div>
                            </div>
                            <div class="gap-3.5 group rounded-lg px-3 [transition:all_0.3s_cubic-bezier(0.4,0,0.2,1)] flex items-center w-full">
                                <img height={52} width={52} draggable={false} class="select-none rounded-lg aspect-square w-[80px]" src={games[4].image} alt={games[4].name} />
                                <div class="w-full h-[100px] border-b border-gray-700/70 group-[:nth-last-child(2)]:border-none flex flex-col gap-2 justify-center">
                                    <span class="font-normal text-white max-w-full text-lg font-title truncate leading-none">
                                        {games[4].name}
                                    </span>
                                    <div class="flex items-center px-2 gap-2">
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
                                                        <Avatar name={(key * 1000).toString()} />
                                                    </div>
                                                </div>
                                            ))}
                                            <div class="ml-[calc(-1*(1-var(--cutout-avatar-percentage-visible)-var(--head-margin-percentage))*var(--size))] rounded-[--size] h-[--size] min-w-[--size] bg-white/[.08] text-[calc(var(--size)/2)] px-[calc(var(--size)/6)] relative flex items-center justify-center text-gray-400">
                                                + 1
                                            </div>
                                        </div>
                                        <p class="font-normal text-gray-400/70 text-sm">Have open parties you can join</p>
                                    </div>
                                </div>
                            </div>
                            <div class="[border:1px_dashed_theme(colors.gray.800)] [mask-image:linear-gradient(rgb(0,0,0)_0%,_rgb(0,0,0)_calc(100%-120px),_transparent_100%)] bottom-0 top-0 -left-[0.4625rem] absolute" />
                        </div>
                    </div>
                </div>
                <div class="gap-2 w-full flex-col flex">
                    <hr class="border-none h-[1.5px] bg-gray-700 w-full" />
                    <div class="text-gray-400/70 text-sm leading-none flex justify-between py-2 px-3 items-end">
                        <span class="text-xl text-white leading-none font-title ">Games</span>
                        <button class="flex gap-1 items-center cursor-pointer hover:text-white transition-all duration-200 outline-none">
                            <svg xmlns="http://www.w3.org/2000/svg" class="flex-shrink-0 size-5" viewBox="0 0 256 256"><path fill="currentColor" d="M248 128a87.34 87.34 0 0 1-17.6 52.81a8 8 0 1 1-12.8-9.62A71.34 71.34 0 0 0 232 128a72 72 0 0 0-144 0a8 8 0 0 1-16 0a88 88 0 0 1 3.29-23.88C74.2 104 73.1 104 72 104a48 48 0 0 0 0 96h24a8 8 0 0 1 0 16H72a64 64 0 1 1 9.29-127.32A88 88 0 0 1 248 128m-69.66 42.34L160 188.69V128a8 8 0 0 0-16 0v60.69l-18.34-18.35a8 8 0 0 0-11.32 11.32l32 32a8 8 0 0 0 11.32 0l32-32a8 8 0 0 0-11.32-11.32" /></svg>
                            <span>Install a game</span>
                        </button>
                    </div>
                    <ul class="relative py-3 w-full grid gap-2 grid-cols-3 list-none after:pointer-events-none after:select-none after:w-full after:h-[120px] after:fixed after:z-10 after:backdrop-blur-[1px] after:bg-gradient-to-b after:from-transparent after:to-gray-900 after:[-webkit-mask-image:linear-gradient(to_top,theme(colors.gray.900)_25%,transparent)]  after:[-webkit-backdrop-filter:1px] after:left-0 after:-bottom-[1px]">
                        {games.map((game, key) => (
                            <div class="size-full group [&_*]:transition-all [&_*]:duration-150 flex flex-col gap-1" key={key}>
                                <img draggable={false} alt={game.name} class="select-none w-full rounded-xl aspect-square group-hover:scale-105 group-hover:shadow-sm group-hover:shadow-black" src={game.image} height={90} width={90} />
                                <div class="flex flex-col px-2 w-full">
                                    <span>{game.name}</span>
                                </div>
                            </div>
                        ))}
                    </ul>
                </div>
            </section>
        </main >
    )
})