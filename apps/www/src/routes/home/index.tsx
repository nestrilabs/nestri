import { component$ } from "@builder.io/qwik";
import { HomeNavBar } from "@nestri/ui";
// import { HomeNavBar } from "@nestri/ui";


const games = [//870780, 914800, 2507950, 1085220, 1568400, 1172470
    {
        id: 2507950,
        name: "Delta Force"
    },
    {
        id: 870780,
        name: "Control Ultimate Edition"
    },
    {
        id: 1172470,
        name: "Apex Legends"
    },
    {
        id: 914800,
        name: "Coffee Talk"
    }, {
        id: 1085220,
        name: "Figment 2: Creed Valley"
    }, {
        id: 1568400,
        name: "Sheepy: A Short Adventure"
    }, {
        id: 271590,
        name: "Grand Theft Auto V"
    }, {
        id: 1086940,
        name: "Baldur's Gate 3"
    }, {
        id: 1091500,
        name: "Cyberpunk 2077"
    }, {
        id: 221100,
        name: "DayZ"
    },

]

export default component$(() => {
    return (
        <main class="flex w-screen h-full flex-col">
            {/* <header class="w-full h-[64px]">
            </header> */}
            <HomeNavBar />
            <section class="max-w-[750px] w-full mx-auto flex flex-col gap-3 px-5 py-20 ">
                <div class="flex flex-col gap-6 w-full py-4">
                    {/* <div class="border-b border-gray-700 flex justify-between pb-3">
                        <span class="text-gray-400/70 text-sm leading-none ">Machines</span>
                        <span class="text-gray-400/70 text-sm leading-none ">Last Played</span>
                    </div> */}
                    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <button class="border-gray-700/70 group transition-all duration-200  border-[0.5px]  h-14  rounded-xl  px-4  gap-2  flex  items-center  justify-between  overflow-hidden  hover:bg-gray-700/70  hover:border-gray-300/70  disabled:opacity-50">
                            <div class="py-2 w-1/2 flex flex-col">
                                <p class="text-text-100 shrink truncate w-full flex">DESKTOP-EUO8VSF</p>
                                {/* <div class="relative text-[10px] leading-none text-gray-400/70 w-full flex shrink truncate">
                                    <p><span class="text-green-500">●●</span>●●●●● 4/30GB used</p>
                                </div> */}
                            </div>
                            <div class="relative h-full flex w-1/2 justify-end">
                                <img alt="game" width={256} height={256} src="https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/1085660/9f2d65473912e04aea5b63378def39dc71be2485.ico" class="h-12 bg-black w-12 translate-y-4 rotate-[14deg] rounded-lg object-cover transition-transform sm:h-16 sm:w-16 group-hover:scale-110" />
                            </div>
                        </button>
                        <button class="border-gray-700/70 group transition-all duration-200 border-[0.5px]  h-14  rounded-xl  px-4  gap-2  flex  items-center  justify-between  overflow-hidden  hover:bg-gray-700/70  hover:border-gray-300/70  disabled:opacity-50">
                            <p class="text-text-100 shrink py-2 truncate w-1/2">DESKTOP-TYUO8VSF</p>
                            <div class="relative h-full flex w-1/2 justify-end">
                                <img alt="game" width={256} height={256} src="https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/578080/f962202b06de547cf47c156bdd7aaa5bf7f2cdbb.ico" class=" h-12 bg-black w-12 translate-y-4 translate-x-[60%] rotate-12 rounded-lg object-cover transition-transform sm:h-16 sm:w-16 group-hover:scale-110" />
                                <img alt="game" width={256} height={256} src="https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/1086940/ea19a7ce2af83c0240e775d79d3b690751a062c1.ico" class="h-12 bg-black w-12 translate-y-4 rotate-[14deg] rounded-lg object-cover transition-transform sm:h-16 sm:w-16 group-hover:scale-110" />
                            </div>
                        </button>
                        <button class="border-gray-700/70 group transition-all duration-200 border-[0.5px]  h-14  rounded-xl  pl-4  gap-2  flex  items-center  justify-between  overflow-hidden  hover:bg-gray-700/70  hover:border-gray-300/70  disabled:opacity-50">
                            <div class="py-2 w-1/2 flex flex-col">
                                <p class="text-text-100 shrink truncate w-full flex">DESKTOP-aEFO8VSF</p>
                                {/* <div class="relative text-[10px] leading-none text-gray-400/70 w-full flex shrink truncate">
                                    <p><span class="text-red-500">●●●●●</span>●● 10/30GB used</p>
                                </div> */}
                            </div>
                            <div class="relative h-full flex w-1/2">
                                <img alt="game" width={256} height={256} src="https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/2767030/bd22e45404f4ed4f3c549b575e23ce76fe03fb07.ico" class=" h-12 bg-black w-12 translate-x-[60%] translate-y-4 rotate-[10deg] rounded-lg object-cover transition-transform sm:h-16 sm:w-16 group-hover:scale-110" />
                                <img alt="game" width={256} height={256} src="https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/578080/f962202b06de547cf47c156bdd7aaa5bf7f2cdbb.ico" class=" h-12 bg-black w-12 translate-y-4 rotate-[12deg] rounded-lg object-cover transition-transform sm:h-16 sm:w-16 group-hover:scale-110" />
                                <img alt="game" width={256} height={256} src="https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/1623730/22a20bdaa6d782f60caa45eb7b02fc2411dcd988.ico" class=" h-12 bg-black w-12 -translate-x-[60%] translate-y-4 rotate-[14deg] rounded-lg object-cover transition-transform sm:h-16 sm:w-16 group-hover:scale-110" />
                            </div>
                        </button>
                        <button class="border-gray-700/70 group transition-all border-dashed duration-200 border-[0.5px]  h-14  rounded-xl  pl-4  gap-2  flex  items-center  justify-between  overflow-hidden  hover:bg-gray-700/70  hover:border-gray-300/70  disabled:opacity-50">
                            <p class="text-text-100 py-2  text-gray-400/70 text-sm leading-none group-hover:text-white shrink truncate flex text-start justify-center items-center gap-2">
                                <svg xmlns="http://www.w3.org/2000/svg" class="flex-shrink-0 size-5" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M11 22c-.818 0-1.6-.33-3.163-.99C3.946 19.366 2 18.543 2 17.16V7m9 15V11.355M11 22c.725 0 1.293-.26 2.5-.777M20 7v4m-5 6.5h7M18.5 21v-7M7.326 9.691L4.405 8.278C2.802 7.502 2 7.114 2 6.5s.802-1.002 2.405-1.778l2.92-1.413C9.13 2.436 10.03 2 11 2s1.871.436 3.674 1.309l2.921 1.413C19.198 5.498 20 5.886 20 6.5s-.802 1.002-2.405 1.778l-2.92 1.413C12.87 10.564 11.97 11 11 11s-1.871-.436-3.674-1.309M5 12l2 1m9-9L6 9" color="currentColor" /></svg>
                                Add another Linux machine
                            </p>
                            {/* <div class="relative h-full flex w-1/2"> */}
                            {/* <img alt="game" width={256} height={256} src="https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/2767030/bd22e45404f4ed4f3c549b575e23ce76fe03fb07.ico" class=" h-12 bg-black w-12 translate-x-[60%] translate-y-4 rotate-[10deg] rounded-lg object-cover transition-transform sm:h-16 sm:w-16 group-hover:scale-110" />
                                <img alt="game" width={256} height={256} src="https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/578080/f962202b06de547cf47c156bdd7aaa5bf7f2cdbb.ico" class=" h-12 bg-black w-12 translate-y-4 rotate-[12deg] rounded-lg object-cover transition-transform sm:h-16 sm:w-16 group-hover:scale-110" />
                                <img alt="game" width={256} height={256} src="https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/1623730/22a20bdaa6d782f60caa45eb7b02fc2411dcd988.ico" class=" h-12 bg-black w-12 -translate-x-[60%] translate-y-4 rotate-[14deg] rounded-lg object-cover transition-transform sm:h-16 sm:w-16 group-hover:scale-110" /> */}
                            {/* </div> */}
                        </button>
                    </div>
                </div>
                <div class="gap-2 w-full flex-col flex">
                    <div class="border-b border-gray-700 text-gray-400/70 text-sm leading-none flex justify-between pb-3 px-3">
                        <span>Title</span>
                        <span>Last Played</span>
                    </div>
                    <ul class="relative w-full flex-col flex list-none p-0 after:pointer-events-none after:select-none after:w-full after:h-[120px] after:fixed after:z-10 after:backdrop-blur-[1px] after:bg-gradient-to-b after:from-transparent after:to-gray-900 after:[-webkit-mask-image:linear-gradient(to_top,theme(colors.gray.900)_25%,transparent)]  after:[-webkit-backdrop-filter:1px] after:left-0 after:-bottom-[1px]">
                        {games.map((game, key) => (
                            <div key={key} class="flex flex-col">
                                <div class="gap-2 hover:bg-gray-700/70 rounded-md group select-none h-[80px] w-full py-1 px-2 relative whitespace-nowrap overflow-hidden transition-all duration-[.25s] ease-in flex items-end text-gray-300 cursor-pointer font-medium text-sm">
                                    <div class="h-full aspect-[77/29]">
                                        <img class="rounded-md aspect-[77/29] object-contain size-full group-hover:scale-110 transition-all duration-200" width={175} height={80} src={`https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${game.id}/capsule_231x87.jpg`} />
                                    </div>
                                    <div class="flex h-full py-2 w-full group-hover:translate-x-3 transition-all duration-200">
                                        <div class="flex h-full max-w-[300px] flex-col gap-2 sm:block hidden">
                                            <span class="whitespace-nowrap overflow-hidden text-ellipsis text-xl font-medium font-title">{game.name}</span>
                                            <div class="grid grid-cols-2  gap-2 text-sm text-gray-400/70">
                                                <div class="flex items-center gap-2">
                                                    <span>20 GB</span>
                                                </div>
                                                <div class="flex items-center gap-2">
                                                    <span>Playtime: 23 hours</span>
                                                </div>
                                            </div>
                                        </div>
                                        <span class="ml-auto mr-2 flex gap-1 text-gray-400/70 transition-all duration-200">
                                            {`${key + 1}`} hours ago
                                        </span>
                                    </div>
                                    {/* <div class="h-4 bg-gray-800/70 absolute bottom-10"/> */}
                                </div>
                                <div class="h-[1px] bg-gray-800/70" />
                            </div>
                        ))}
                    </ul>
                </div>
            </section>
        </main>
    )
})