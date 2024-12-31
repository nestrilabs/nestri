import { component$ } from "@builder.io/qwik";
import { HomeNavBar } from "@nestri/ui";

export default component$(() => {
    return (
        <>
            <HomeNavBar />
            {/* <div class="bg-red-500 h-[66px] w-screen"></div> */}
            {/* <section class="absolute flex mx-auto my-0 inset-[0_0_20%] overflow-hidden -z-[1] before:inset-0 before:absolute before:z-[1] after:absolute after:inset-0 after:[background:linear-gradient(180deg,transparent_60%,#000)] before:[background:linear-gradient(90deg,transparent_85%,#000),linear-gradient(-90deg,transparent_85%,#000)]" >
                <img src="https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/1172470/library_hero_2x.jpg" height={200} width={300} class="max-w-full min-w-full max-h-full min-h-full object-cover absolute top-0 bottom-0 left-0 right-0 w-0 h-0"/>
            </section> */}

            <section class="w-full top-[70px] pb-5 ring-gray-300 ring-2 max-w-3xl rounded-xl overflow-hidden relative h-auto shadow-xl">
                <div class="w-full h-auto relative">
                    <img src="https://media.rawg.io/media/games/511/5118aff5091cb3efec399c808f8c598f.jpg" height={200} width={300} class="w-full aspect-[16/9]  object-cover" />
                    <img src="https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/1174180/logo_2x.png?t=1671484934" height={200} width={300} class="w-[40%] aspect-[16/9] absolute bottom-4 left-1/2 -translate-x-1/2  object-cover" />
                </div>
                <div class="px-6 pt-2">
                    <div class="flex  gap-2 items-center h-max">
                        {/* <img src="https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/1174180/5bf6edd7efb1110b457da905e7ac696c6c619ed1.ico" height={20} width={20} class="size-10 bg-black aspect-square rounded-xl ring-2 ring-gray-700" /> */}
                        <p class="text-2xl font-title font-bold">Red Dead Redemption 2</p>
                    </div>
                </div>
            </section>
            {/* <section class="w-full before:inset-0 before:absolute before:z-[1] relative after:bg-gradient-to-b after:from-transparent after:from-60% after:to-black before:[background:linear-gradient(90deg,transparent_70%,#000),linear-gradient(-90deg,transparent_70%,#000)]" >
                <img src="https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/359550/library_hero_2x.jpg" height={200} width={300} class="w-full aspect-[96/31]"/>
            </section><section class="w-full before:inset-0 before:absolute before:z-[1] relative after:bg-gradient-to-b after:from-transparent after:from-60% after:to-black before:[background:linear-gradient(90deg,transparent_70%,#000),linear-gradient(-90deg,transparent_70%,#000)]" >
                <img src="https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/359550/library_hero_2x.jpg" height={200} width={300} class="w-full aspect-[96/31]"/>
            </section><section class="w-full before:inset-0 before:absolute before:z-[1] relative after:bg-gradient-to-b after:from-transparent after:from-60% after:to-black before:[background:linear-gradient(90deg,transparent_70%,#000),linear-gradient(-90deg,transparent_70%,#000)]" >
                <img src="https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/359550/library_hero_2x.jpg" height={200} width={300} class="w-full aspect-[96/31]"/>
            </section><section class="w-full before:inset-0 before:absolute before:z-[1] relative after:bg-gradient-to-b after:from-transparent after:from-60% after:to-black before:[background:linear-gradient(90deg,transparent_70%,#000),linear-gradient(-90deg,transparent_70%,#000)]" >
                <img src="https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/359550/library_hero_2x.jpg" height={200} width={300} class="w-full aspect-[96/31]"/>
            </section> */}
            {/* <section class="flex flex-col gap-4 justify-center pt-20 items-center w-full text-left pb-4">
                <div class="flex flex-col gap-4 mx-auto max-w-2xl w-full">
                    <h1 class="text-5xl font-bold font-title">{getGreeting()},&nbsp;<span>Wanjohi</span></h1>
                    <p class="dark:text-gray-50/70 text-gray-950/70 text-xl">What will you play today?</p>
                </div>
            </section> */}
            {/* <section class="flex flex-col gap-4 justify-center pt-10 items-center w-full text-left pb-4">
                <ul class="gap-4 relative list-none w-full max-w-xl lg:max-w-4xl grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 after:pointer-events-none after:select-none after:bg-gradient-to-b after:from-transparent after:dark:to-gray-900 after:to-gray-100 after:fixed after:left-0 after:-bottom-[1px] after:z-10 after:backdrop-blur-sm after:h-[100px] after:w-full after:[-webkit-mask-image:linear-gradient(to_top,theme(colors.primary.100)_50%,transparent)] after:dark:[-webkit-mask-image:linear-gradient(to_top,theme(colors.primary.900)_50%,transparent)]">
                    <li class="col-span-full">
                        <Card
                            size="large"
                            titleWidth={55.61}
                            titleHeight={100}
                            game={{
                                name: 'Control Ultimate Edition',
                                id: 870780
                            }}
                        />
                    </li>
                    <li>
                        <Card
                            size="small"
                            titleWidth={56.30}
                            titleHeight={69.79}
                            game={{
                                name: 'Black Myth: Wukong',
                                id: 2358720,
                            }}
                        />
                    </li>
                    <li>
                        <Card
                            size="small"
                            titleWidth={34.09}
                            titleHeight={98.26}
                            game={{
                                name: 'The Lord of the Rings: Return to Moria™',
                                id: 2933130,
                            }}
                        />
                    </li>
                    <li>
                        <Card
                            size="small"
                            titleWidth={48.77}
                            titleHeight={100}
                            game={{
                                name: 'Grand Theft Auto V',
                                id: 271590,
                            }}
                        />
                    </li>
                    <li>
                        <Card
                            titleWidth={31.65}
                            titleHeight={82.87}
                            size="small"
                            game={{
                                name: 'Apex Legends',
                                id: 1172470,
                            }}
                        />
                    </li>
                    <li>
                        <Card
                            size="small"
                            titleHeight={99.75}
                            titleWidth={73.44}
                            game={{
                                name: "Tom Clancy's Rainbow Six Siege",
                                id: 359550,
                            }}
                        />
                    </li>
                </ul>
            </section> */}
        </>
    )
})