import { component$ } from "@builder.io/qwik";
import { HomeNavBar, SimpleFooter } from "@nestri/ui";
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
                        <button class="border-gray-400/70 dark:border-gray-700/70 hover:ring-2 hover:ring-[#8f8f8f] dark:hover:ring-[#707070] group transition-all border-dashed duration-200 border-[2px]  h-14  rounded-xl  pl-4  gap-2  flex  items-center  justify-between  overflow-hidden  hover:bg-gray-300/70 dark:hover:bg-gray-700/70 outline-none  disabled:opacity-50">
                            <span class="py-2 text-gray-600/70 dark:text-gray-400/70 leading-none group-hover:text-black dark:group-hover:text-white shrink truncate flex text-start justify-center items-center gap-2">
                                <svg xmlns="http://www.w3.org/2000/svg" class="flex-shrink-0 size-5" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M11.505 2h-1.501c-3.281 0-4.921 0-6.084.814a4.5 4.5 0 0 0-1.106 1.105C2 5.08 2 6.72 2 10s0 4.919.814 6.081a4.5 4.5 0 0 0 1.106 1.105C5.083 18 6.723 18 10.004 18h4.002c3.28 0 4.921 0 6.084-.814a4.5 4.5 0 0 0 1.105-1.105c.63-.897.772-2.08.805-4.081m-8-6h4m0 0h4m-4 0V2m0 4v4m-7 5h2m-1 3v4m-4 0h8" color="currentColor" /></svg>
                                Add another Linux machine
                            </span>
                        </button>
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
                            <button class="flex gap-1 items-center [&>svg]:size-5 cursor-pointer hover:text-gray-800 dark:hover:text-gray-200 transition-all duration-200 outline-none">
                                <svg xmlns="http://www.w3.org/2000/svg" class="flex-shrink-0" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v14m-7-7h14" /></svg>
                                <span>Create a party</span>
                            </button>
                        </div>
                        <ul class="list-none w-full ml-4 relative">
                            {games.slice(5, 8).sort().map((game, key) => (
                                <button key={`find-${key}`} class="gap-3.5 text-left hover:bg-gray-300/70 dark:hover:bg-gray-700/70 hover:ring-2 hover:ring-[#8f8f8f] dark:hover:ring-[#707070] outline-none group rounded-lg px-3 [transition:all_0.3s_cubic-bezier(0.4,0,0.2,1)] flex items-center w-full">
                                    <img height={52} width={52} draggable={false} class="[transition:all_0.3s_cubic-bezier(0.4,0,0.2,1)] group-hover:scale-105 group-hover:shadow-lg group-hover:shadow-gray-900 select-none rounded-lg aspect-square w-[80px]" src={game.image} alt={game.name} />
                                    <div class="w-full h-[100px] border-b-2 border-gray-400/70 dark:border-gray-700/70 flex group-[:nth-last-child(2)]:border-none flex-col gap-2 justify-center">
                                        <span class="font-medium tracking-tighter text-gray-700 dark:text-gray-300 max-w-full text-lg font-title truncate leading-none w-full">
                                            {game.name}
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
                                                            <Avatar name={(key * Math.floor(100 * Math.random())).toString()} />
                                                        </div>
                                                    </div>
                                                ))}
                                                <div class="ml-[calc(-1*(1-var(--cutout-avatar-percentage-visible)-var(--head-margin-percentage))*var(--size))] rounded-[--size] h-[--size] min-w-[--size] bg-gray-500/70 text-[calc(var(--size)/2)] px-[calc(var(--size)/6)] relative flex items-center justify-center text-gray-100">
                                                    {`+${Math.floor(Math.random() * 10)}`}
                                                </div>
                                            </div>
                                            <p class="font-normal text-gray-600 dark:text-gray-400 text-sm">open parties you can join</p>
                                        </div>
                                    </div>
                                </button>
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
                            <button class="hover:bg-gray-300/70 dark:hover:bg-gray-700/70 [transition:all_0.3s_cubic-bezier(0.4,0,0.2,1)] px-2 py-2 rounded-[15px] hover:ring-2 hover:ring-[#8f8f8f] dark:hover:ring-[#707070] outline-none size-full group [&_*]:transition-all [&_*]:duration-150 flex flex-col gap-2" key={key}>
                                <img draggable={false} alt={game.name} class="select-none [transition:all_0.3s_cubic-bezier(0.4,0,0.2,1)] group-hover:scale-[1.01] group-hover:shadow-lg group-hover:shadow-gray-900 w-full rounded-xl aspect-square" src={game.image} height={90} width={90} />
                                <div class="flex flex-col px-2 w-full">
                                    <span class="max-w-full truncate">{game.name}</span>
                                </div>
                            </button>
                        ))}
                    </ul>
                </div>
            </section>
            <SimpleFooter />
        </main >
    )
})