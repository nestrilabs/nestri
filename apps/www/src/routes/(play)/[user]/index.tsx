import { cn } from "@nestri/ui/design";
import type Nestri from "@nestri/sdk";
import { Modal } from "@qwik-ui/headless";
import { Avatar, Icons } from "@nestri/ui";
import { component$, useSignal, useStore, useVisibleTask$ } from "@builder.io/qwik";
import { routeLoader$ } from "@builder.io/qwik-city";
import { HomeNavBar, SimpleFooter, GameStoreButton } from "@nestri/ui";

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
    // const res = sharedMap.get("profile") as Nestri.Users.UserRetrieveResponse.Data | null

    // return res
    return {
        avatarUrl: undefined,
        discriminator: 47,
        username: "WanjohiRyan"
    }
})
//bg-blue-100 rounded-lg p-4 min-w-16 text-center
const TimeUnit = ({ value, label }: { value: number, label: string }) => (
    <div class="flex flex-col items-center bg-blue-100 rounded-lg p-4">
        <div style={{ "--line-height": "2rem" }} class="flex leading-none items-center text-[2rem] font-medium font-title">
            {new Array(2).fill(0).map((_, key) => {
                const [digitOne, digitTwo] = value.toString().padStart(2, '0')
                return (
                    <div style={{ "--digit-one": Number(digitOne), "--digit-two": Number(digitTwo) }} key={`digit-${key}`} class={cn("h-[--line-height] overflow-hidden", key == 0 ? "first-of-type:[--v:var(--digit-one)]" : "last-of-type:[--v:var(--digit-two)]")} >
                        <div class={cn("digit_timing flex flex-col", key == 0 ? "items-end" : "items-start")}>
                            <div>9</div>
                            <div>0</div>
                            <div>1</div>
                            <div>2</div>
                            <div>3</div>
                            <div>4</div>
                            <div>5</div>
                            <div>6</div>
                            <div>7</div>
                            <div>8</div>
                            <div>9</div>
                            <div>0</div>
                        </div>
                    </div>
                )
            })}
        </div>
        <div class="text-xs mt-1 text-gray-600">{label}</div>
    </div>
);

export default component$(() => {
    const profile = useCurrentProfile()
    const isNewPerson = useSignal(false)
    const targetDate = new Date('2025-01-28T23:59:00Z');

    const timeLeft = useStore({
        days: 0,
        hours: 0,
        minutes: 0,
        seconds: 0
    })

    // eslint-disable-next-line qwik/no-use-visible-task
    useVisibleTask$(() => {
        isNewPerson.value = true

        const calculateTimeLeft = () => {
            const difference = targetDate.getTime() - new Date().getTime();

            if (difference > 0) {
                const days = Math.floor(difference / (1000 * 60 * 60 * 24));
                const hours = Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));
                const seconds = Math.floor((difference % (1000 * 60)) / 1000);

                timeLeft.days = days
                timeLeft.hours = hours
                timeLeft.minutes = minutes
                timeLeft.seconds = seconds
            }
        };

        calculateTimeLeft();

        const timer = setInterval(calculateTimeLeft, 1000);

        return () => clearInterval(timer);
    })

    return (
        <main class="flex w-screen h-full flex-col">
            {profile.value && <HomeNavBar avatarUrl={profile.value.avatarUrl} discriminator={profile.value.discriminator} username={profile.value.username} />}
            <section class="max-w-[750px] w-full mx-auto flex flex-col gap-3 px-5 pt-20 pb-14 ">
                <div class="flex flex-col gap-6 w-full py-4">
                    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <GameStoreButton />
                        <Modal.Root class="w-full">
                            <Modal.Trigger class="border-gray-400/70 w-full dark:border-gray-700/70 hover:ring-2 hover:ring-[#8f8f8f] dark:hover:ring-[#707070] group transition-all border-dashed duration-200 border-[2px] h-14 rounded-xl pl-4 gap-2 flex items-center justify-between overflow-hidden hover:bg-gray-300/70 dark:hover:bg-gray-700/70 outline-none  disabled:opacity-50">
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
                                            Download and install Nestri on your remote server or computer to connect it. Then paste the generated machine id here.
                                        </div>
                                    </div>
                                    <form action="#" class="mt-3 flex flex-col gap-3" >
                                        <input placeholder="fc27f428f9ca47d4b41b707ae0c62090" class="transition-all duration-200 w-full px-2 py-3 h-10 border text-black dark:text-white dark:border-[#343434] border-[#e2e2e2] rounded-md text-sm outline-none bg-white dark:bg-[rgba(19,21,23,0.64)] leading-none [background-image:-webkit-linear-gradient(hsla(0,0%,100%,0),hsla(0,0%,100%,0))]
                                            focus:[box-shadow:0_0_0_2px_#fcfcfc,0_0_0_4px_#8f8f8f] dark:focus:[box-shadow:0_0_0_2px_#161616,0_0_0_4px_#707070]" />
                                        <button class="w-full h-[calc(2.25rem+2*1px)] transition-all duration-200 hover:[box-shadow:0_0_0_2px_#fcfcfc,0_0_0_4px_#8f8f8f] dark:hover:[box-shadow:0_0_0_2px_#161616,0_0_0_4px_#707070] focus:[box-shadow:0_0_0_2px_#fcfcfc,0_0_0_4px_#8f8f8f] dark:focus:[box-shadow:0_0_0_2px_#161616,0_0_0_4px_#707070] outline-none bg-primary-500 text-white rounded-lg text-sm" >Add machine</button>
                                    </form>
                                </div>
                            </Modal.Panel>
                        </Modal.Root>
                    </div>
                </div >
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
                    <ul class="relative py-3 w-full grid sm:grid-cols-3 grid-cols-2 list-none after:pointer-events-none after:select-none after:w-full after:h-[120px] after:fixed after:z-10 after:backdrop-blur-[1px] after:bg-gradient-to-b after:from-transparent after:to-gray-100 dark:after:to-gray-900 after:[-webkit-mask-image:linear-gradient(to_top,theme(colors.gray.100)_25%,transparent)] dark:after:[-webkit-mask-image:linear-gradient(to_top,theme(colors.gray.900)_25%,transparent)] after:left-0 after:-bottom-[1px]">
                        {games.map((game, key) => (
                            <Modal.Root key={`game-${key}`} >
                                <Modal.Trigger class="hover:bg-gray-300/70 dark:hover:bg-gray-700/70 [transition:all_0.3s_cubic-bezier(0.4,0,0.2,1)] px-2 py-2 rounded-[15px] hover:ring-2 hover:ring-[#8f8f8f] dark:hover:ring-[#707070] outline-none size-full group [&_*]:transition-all [&_*]:duration-150 flex flex-col gap-2" key={key}>
                                    <img draggable={false} alt={game.name} class="select-none [transition:all_0.3s_cubic-bezier(0.4,0,0.2,1)] group-hover:scale-[1.01] group-hover:shadow-lg group-hover:shadow-gray-900 w-full rounded-xl aspect-square" src={game.image} height={90} width={90} />
                                    <div class="flex flex-col px-2 w-full">
                                        <span class="max-w-full truncate">{game.name}</span>
                                    </div>
                                </Modal.Trigger>
                                <Modal.Panel class="dark:backdrop:bg-[#0009] backdrop:bg-[#b3b5b799] backdrop:backdrop-grayscale-[.3] rounded-xl border dark:border-[#343434] border-gray-600/70
                                            dark:[box-shadow:0_0_0_1px_rgba(255,255,255,0.08),_0_3.3px_2.7px_rgba(0,0,0,.1),0_8.3px_6.9px_rgba(0,0,0,.13),0_17px_14.2px_rgba(0,0,0,.17),0_35px_29.2px_rgba(0,0,0,.22),0px_-4px_4px_0px_rgba(0,0,0,.04)_inset] dark:bg-[rgb(22,22,22)] 
                                            box-shadow:0_0_0_1px_rgba(19,21,23,0.08),_0_3.3px_2.7px_rgba(0,0,0,.03),0_8.3px_6.9px_rgba(0,0,0,.04),0_17px_14.2px_rgba(0,0,0,.05),0_35px_29.2px_rgba(0,0,0,.06),0px_-4px_4px_0px_rgba(0,0,0,.07)_inset] bg-gray-300
                                            backdrop-blur-lg modal" >
                                    <div class="flex flex-col min-w-[17rem] relative text-black/70 dark:text-white/70 w-full max-w-[41.8125rem] min-h-[min(90%,100%-3rem)]" >
                                        <div class="flex-1 relative w-full " >
                                            <div class="relative w-full pb-[56.25%] overflow-hidden after:z-[2] after:absolute after:inset-0 dark:after:[background:linear-gradient(40deg,rgb(22,22,22)_24.16%,rgba(6,10,23,0)_56.61%),linear-gradient(0deg,rgb(22,22,22)_3.91%,rgba(6,10,23,0)_69.26%)] after:[background:linear-gradient(0deg,theme(colors.gray.300)_3.91%,theme(colors.gray.300/0.03)_69.26%)]" >
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
                                                    class="absolute dark:bottom-0 min-[600px]:left-10 left-4 bg-contain bg-[center_bottom] bg-no-repeat min-[600px]:max-w-[40%] w-full aspect-video z-[3] bottom-[20px] " />
                                            </div>
                                            <div class="min-[600px]:p-10 min-[600px]:pt-4 pt-4 px-4 pb-6" >
                                                <ul class="[&_svg]:-mt-[2px] xl:mb-3 min-[960px]:mb-2 min-[600px]:leading-5 mb-4 leading-[0.625rem] list-none flex w-full" >
                                                    <li class="mr-2 flex gap-0.5 [&>svg]:size-[14px] items-center justify-center text-sm dark:bg-[rgb(65,65,65)] bg-[rgb(171,171,171)] px-2 py-1 w-max rounded-md" >
                                                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 16 16"><path fill="currentColor" fill-rule="evenodd" d="M7.238 2.634a.75.75 0 1 0-1.476-.268L5.283 5H3a.75.75 0 1 0 0 1.5h2.01l-.545 3H2A.75.75 0 1 0 2 11h2.192l-.43 2.366a.75.75 0 1 0 1.476.268L5.717 11h3.475l-.43 2.366a.75.75 0 1 0 1.476.268L10.717 11H13a.75.75 0 0 0 0-1.5h-2.01l.545-3H14A.75.75 0 0 0 14 5h-2.192l.43-2.366a.75.75 0 1 0-1.476-.268L10.283 5H6.808zM9.465 9.5l.545-3H6.535l-.545 3z" clip-rule="evenodd" /></svg>
                                                        Shooter
                                                    </li>
                                                    <li class="mr-2 flex gap-0.5 [&>svg]:size-[14px] items-center  justify-center text-sm dark:bg-[rgb(65,65,65)] bg-[rgb(171,171,171)] px-2 py-1 w-max rounded-md" >
                                                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 16 16"><path fill="currentColor" fill-rule="evenodd" d="M7.238 2.634a.75.75 0 1 0-1.476-.268L5.283 5H3a.75.75 0 1 0 0 1.5h2.01l-.545 3H2A.75.75 0 1 0 2 11h2.192l-.43 2.366a.75.75 0 1 0 1.476.268L5.717 11h3.475l-.43 2.366a.75.75 0 1 0 1.476.268L10.717 11H13a.75.75 0 0 0 0-1.5h-2.01l.545-3H14A.75.75 0 0 0 14 5h-2.192l.43-2.366a.75.75 0 1 0-1.476-.268L10.283 5H6.808zM9.465 9.5l.545-3H6.535l-.545 3z" clip-rule="evenodd" /></svg>
                                                        Action
                                                    </li>
                                                    <li class="mr-2 flex gap-0.5 [&>svg]:size-[14px] items-center justify-center text-sm dark:bg-[rgb(65,65,65)] bg-[rgb(171,171,171)] px-2 py-1 w-max rounded-md" >
                                                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 16 16"><path fill="currentColor" fill-rule="evenodd" d="M7.238 2.634a.75.75 0 1 0-1.476-.268L5.283 5H3a.75.75 0 1 0 0 1.5h2.01l-.545 3H2A.75.75 0 1 0 2 11h2.192l-.43 2.366a.75.75 0 1 0 1.476.268L5.717 11h3.475l-.43 2.366a.75.75 0 1 0 1.476.268L10.717 11H13a.75.75 0 0 0 0-1.5h-2.01l.545-3H14A.75.75 0 0 0 14 5h-2.192l.43-2.366a.75.75 0 1 0-1.476-.268L10.283 5H6.808zM9.465 9.5l.545-3H6.535l-.545 3z" clip-rule="evenodd" /></svg>
                                                        Free to play
                                                    </li>
                                                </ul>
                                                <p class="text-black/90 dark:text-white/90 tracking-tight" >
                                                    Delta Force is a first-person shooter which offers players both a single player campaign based on the movie Black Hawk Down, but also large-scale PvP multiplayer action. The game was formerly known as Delta Force: Hawk Ops.
                                                </p>
                                                <div class="sm:pt-10 sm:block hidden" >
                                                    <button class="gap-3 outline-none hover:[box-shadow:0_0_0_2px_rgba(200,200,200,0.95),0_0_0_4px_#8f8f8f] dark:hover:[box-shadow:0_0_0_2px_#161616,0_0_0_4px_#707070] focus:[box-shadow:0_0_0_2px_rgba(200,200,200,0.95),0_0_0_4px_#8f8f8f] dark:focus:[box-shadow:0_0_0_2px_#161616,0_0_0_4px_#707070] [transition:all_0.3s_cubic-bezier(0.4,0,0.2,1)] font-medium font-title rounded-lg flex h-[calc(2.25rem+2*1px)] flex-col text-white w-full leading-none truncate bg-primary-500 items-center justify-center" >
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
            </section >
            <SimpleFooter />
            <Modal.Root bind:show={isNewPerson} closeOnBackdropClick={false}>
                <Modal.Panel
                    class="dark:bg-gray-700 bg-white [box-shadow:0_8px_30px_rgba(0,0,0,.12)]
                    dark:backdrop:bg-[#0009] backdrop:bg-[#b3b5b799] backdrop:backdrop-grayscale-[.3] max-h-[75vh] rounded-xl
                    backdrop-blur-md modal w-full max-w-[740px] outline-none overflow-visible">
                    <div class="relative select-none">
                        <div class="pointer-events-auto flex w-full flex-col rounded-xl relative bg-white dark:bg-gray-700/70">
                            <span class="absolute inset-0 z-0 size-full rounded-xl bg-gradient-to-b from-[rgb(17,168,255)] to-[rgb(160,221,255)] dark:from-[rgb(93,94,162)] dark:via-[rgb(33,143,205)] dark:to-[rgb(112,203,255)]" />
                            <div class="rounded-xl relative p-6">
                                <div class="flex w-full flex-row justify-start gap-6">
                                    <div class="-mt-6 flex w-[280px] flex-col items-center gap-6 rounded-b-xl bg-gradient-to-b dark:from-gray-100 dark:to-gray-50 from-gray-200 to-gray-100 px-6 pb-6 shadow-lg">
                                        <div class="-mt-7 flex flex-row items-center justify-center gap-2 text-center text-sm text-white/80">
                                            <svg width="96" height="52" viewBox="0 0 96 52" fill="none" xmlns="http://www.w3.org/2000/svg"><g filter="url(#filter0_di_4064_903)">
                                                <mask id="path-1-inside-1_4064_903" fill="white"><path fill-rule="evenodd" clip-rule="evenodd" d="M64 20C64 22.0476 65.4906 24 67.5382 24H81.6C83.8402 24 84.9603 24 85.816 24.436C86.5686 24.8195 87.1805 25.4314 87.564 26.184C88 27.0397 88 28.1598 88 30.4V33.6C88 35.8402 88 36.9603 87.564 37.816C87.1805 38.5686 86.5686 39.1805 85.816 39.564C84.9603 40 83.8402 40 81.6 40H14.4C12.1598 40 11.0397 40 10.184 39.564C9.43139 39.1805 8.81947 38.5686 8.43597 37.816C8 36.9603 8 35.8402 8 33.6V30.4C8 28.1598 8 27.0397 8.43597 26.184C8.81947 25.4314 9.43139 24.8195 10.184 24.436C11.0397 24 12.1598 24 14.4 24H28.4617C30.5094 24 32 22.0476 32 20C32 11.1634 39.1634 4 48 4C56.8366 4 64 11.1634 64 20ZM48 24C50.2091 24 52 22.2091 52 20C52 17.7909 50.2091 16 48 16C45.7909 16 44 17.7909 44 20C44 22.2091 45.7909 24 48 24Z"></path></mask>
                                                <path fill-rule="evenodd" clip-rule="evenodd" d="M64 20C64 22.0476 65.4906 24 67.5382 24H81.6C83.8402 24 84.9603 24 85.816 24.436C86.5686 24.8195 87.1805 25.4314 87.564 26.184C88 27.0397 88 28.1598 88 30.4V33.6C88 35.8402 88 36.9603 87.564 37.816C87.1805 38.5686 86.5686 39.1805 85.816 39.564C84.9603 40 83.8402 40 81.6 40H14.4C12.1598 40 11.0397 40 10.184 39.564C9.43139 39.1805 8.81947 38.5686 8.43597 37.816C8 36.9603 8 35.8402 8 33.6V30.4C8 28.1598 8 27.0397 8.43597 26.184C8.81947 25.4314 9.43139 24.8195 10.184 24.436C11.0397 24 12.1598 24 14.4 24H28.4617C30.5094 24 32 22.0476 32 20C32 11.1634 39.1634 4 48 4C56.8366 4 64 11.1634 64 20ZM48 24C50.2091 24 52 22.2091 52 20C52 17.7909 50.2091 16 48 16C45.7909 16 44 17.7909 44 20C44 22.2091 45.7909 24 48 24Z" fill="url(#paint0_linear_4064_903)"></path>
                                                <path d="M10.184 39.564L9.73005 40.455L10.184 39.564ZM8.43597 37.816L7.54497 38.27L8.43597 37.816ZM87.564 37.816L86.673 37.362L87.564 37.816ZM85.816 39.564L86.27 40.455L85.816 39.564ZM85.816 24.436L86.27 23.545L85.816 24.436ZM87.564 26.184L86.673 26.638L87.564 26.184ZM8.43597 26.184L9.32698 26.638L8.43597 26.184ZM81.6 23H67.5382V25H81.6V23ZM89 33.6V30.4H87V33.6H89ZM14.4 41H81.6V39H14.4V41ZM7 30.4V33.6H9V30.4H7ZM28.4617 23H14.4V25H28.4617V23ZM48 3C38.6112 3 31 10.6112 31 20H33C33 11.7157 39.7157 5 48 5V3ZM65 20C65 10.6112 57.3888 3 48 3V5C56.2843 5 63 11.7157 63 20H65ZM51 20C51 21.6569 49.6569 23 48 23V25C50.7614 25 53 22.7614 53 20H51ZM48 17C49.6569 17 51 18.3431 51 20H53C53 17.2386 50.7614 15 48 15V17ZM45 20C45 18.3431 46.3431 17 48 17V15C45.2386 15 43 17.2386 43 20H45ZM48 23C46.3431 23 45 21.6569 45 20H43C43 22.7614 45.2386 25 48 25V23ZM28.4617 25C31.2131 25 33 22.4353 33 20H31C31 21.66 29.8057 23 28.4617 23V25ZM14.4 39C13.2634 39 12.4711 38.9992 11.8542 38.9488C11.2491 38.8994 10.9014 38.8072 10.638 38.673L9.73005 40.455C10.3223 40.7568 10.9625 40.8826 11.6914 40.9422C12.4086 41.0008 13.2964 41 14.4 41V39ZM7 33.6C7 34.7036 6.99922 35.5914 7.05782 36.3086C7.11737 37.0375 7.24318 37.6777 7.54497 38.27L9.32698 37.362C9.19279 37.0986 9.10062 36.7509 9.05118 36.1458C9.00078 35.5289 9 34.7366 9 33.6H7ZM10.638 38.673C10.0735 38.3854 9.6146 37.9265 9.32698 37.362L7.54497 38.27C8.02433 39.2108 8.78924 39.9757 9.73005 40.455L10.638 38.673ZM87 33.6C87 34.7366 86.9992 35.5289 86.9488 36.1458C86.8994 36.7509 86.8072 37.0986 86.673 37.362L88.455 38.27C88.7568 37.6777 88.8826 37.0375 88.9422 36.3086C89.0008 35.5914 89 34.7036 89 33.6H87ZM81.6 41C82.7036 41 83.5914 41.0008 84.3086 40.9422C85.0375 40.8826 85.6777 40.7568 86.27 40.455L85.362 38.673C85.0986 38.8072 84.7509 38.8994 84.1458 38.9488C83.5289 38.9992 82.7366 39 81.6 39V41ZM86.673 37.362C86.3854 37.9265 85.9265 38.3854 85.362 38.673L86.27 40.455C87.2108 39.9757 87.9757 39.2108 88.455 38.27L86.673 37.362ZM81.6 25C82.7366 25 83.5289 25.0008 84.1458 25.0512C84.7509 25.1006 85.0986 25.1928 85.362 25.327L86.27 23.545C85.6777 23.2432 85.0375 23.1174 84.3086 23.0578C83.5914 22.9992 82.7036 23 81.6 23V25ZM89 30.4C89 29.2964 89.0008 28.4086 88.9422 27.6914C88.8826 26.9625 88.7568 26.3223 88.455 25.73L86.673 26.638C86.8072 26.9014 86.8994 27.2491 86.9488 27.8542C86.9992 28.4711 87 29.2634 87 30.4H89ZM85.362 25.327C85.9265 25.6146 86.3854 26.0735 86.673 26.638L88.455 25.73C87.9757 24.7892 87.2108 24.0243 86.27 23.545L85.362 25.327ZM9 30.4C9 29.2634 9.00078 28.4711 9.05118 27.8542C9.10062 27.2491 9.19279 26.9014 9.32698 26.638L7.54497 25.73C7.24318 26.3223 7.11737 26.9625 7.05782 27.6914C6.99922 28.4086 7 29.2964 7 30.4H9ZM14.4 23C13.2964 23 12.4085 22.9992 11.6914 23.0578C10.9625 23.1174 10.3223 23.2432 9.73005 23.545L10.638 25.327C10.9014 25.1928 11.2491 25.1006 11.8542 25.0512C12.4711 25.0008 13.2634 25 14.4 25V23ZM9.32698 26.638C9.6146 26.0735 10.0735 25.6146 10.638 25.327L9.73005 23.545C8.78924 24.0243 8.02433 24.7892 7.54497 25.73L9.32698 26.638ZM63 20C63 22.4353 64.7869 25 67.5382 25V23C66.1943 23 65 21.66 65 20H63Z" fill="url(#paint1_linear_4064_903)" mask="url(#path-1-inside-1_4064_903)"></path></g>
                                                <defs><filter id="filter0_di_4064_903" x="0" y="0" width="96" height="52" filterUnits="userSpaceOnUse" color-interpolation-filters="s-rGB"><feFlood flood-opacity="0" result="BackgroundImageFix"></feFlood><feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"></feColorMatrix><feOffset dy="4"></feOffset><feGaussianBlur stdDeviation="4"></feGaussianBlur><feComposite in2="hardAlpha" operator="out"></feComposite><feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.1 0"></feColorMatrix><feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_4064_903"></feBlend><feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow_4064_903" result="shape"></feBlend><feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"></feColorMatrix><feOffset dy="-1"></feOffset><feGaussianBlur stdDeviation="0.5"></feGaussianBlur><feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1"></feComposite><feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.3 0"></feColorMatrix><feBlend mode="normal" in2="shape" result="effect2_innerShadow_4064_903"></feBlend></filter><linearGradient id="paint0_linear_4064_903" x1="48" y1="4" x2="48" y2="40" gradientUnits="userSpaceOnUse"><stop stop-color="white"></stop><stop offset="0.6" stop-color="#CCCCCC"></stop><stop offset="1" stop-color="white"></stop></linearGradient><linearGradient id="paint1_linear_4064_903" x1="48" y1="4" x2="48" y2="12" gradientUnits="userSpaceOnUse"><stop stop-color="white"></stop><stop offset="1" stop-color="white" stop-opacity="0"></stop></linearGradient></defs>
                                            </svg>
                                        </div>
                                        <div class="relative -mt-1 text-center text-base font-medium text-gray-800">Nestri needs your help</div>
                                        <div class="flex flex-row items-center justify-center gap-2 text-center text-sm text-white/80 [&>svg]:size-5">
                                            {profile.value.avatarUrl ? (<img src={profile.value.avatarUrl} height={20} width={20} class="size-6 rounded-full" alt="Avatar" />) : (<Avatar name={`${profile.value.username}#${profile.value.discriminator}`} />)}
                                            <span class="text-balance text-xs font-medium leading-tight text-black font-title">
                                                {profile.value.username}
                                            </span>
                                        </div>
                                        <div class="w-full">
                                            <div class="relative flex items-center justify-center gap-4">
                                                <div class="h-[1px] flex-1 bg-gray-300/70" />
                                                <div class="text-center text-xs font-medium text-gray-500">What's wrong?</div>
                                                <div class="h-[1px] flex-1 bg-gray-300/70" />
                                            </div>
                                        </div>
                                        <div class="flex flex-row items-start gap-4">
                                            <div class="flex size-4 shrink-0 items-center justify-center rounded-full bg-gray-200/70 text-xs font-semibold text-gray-400">1</div>
                                            <div class="text-xs text-gray-700">We're almost ready to launch Nestri, but server costs are our biggest hurdle right now.</div>
                                        </div>
                                        <div class="flex flex-row items-start gap-4">
                                            <div class="flex size-4 shrink-0 items-center justify-center rounded-full bg-gray-200/70 text-xs font-semibold text-gray-400">2</div>
                                            <div class="text-xs text-gray-700">As a bootstrapped startup (yeah, just a few passionate developers!), we're reaching out to our early believers.</div>
                                        </div>
                                        <div class="flex flex-row items-start gap-4">
                                            <div class="flex size-4 shrink-0 items-center justify-center rounded-full bg-gray-200/70 text-xs font-semibold text-gray-400">3</div>
                                            <div class="text-xs text-gray-700">Your early access subscription will directly fund our initial server infrastructure, helping us bring self-hosted cloud gaming to life.</div>
                                        </div>
                                    </div>
                                    <div class="flex h-max w-max max-w-[380px] flex-col items-start gap-6">
                                        <div>
                                            <div class="h-12 text-center font-title text-lg font-medium text-white [text-shadow:0_4px_10px_rgba(0,87,255,.2),_0_-4px_10px_rgba(255,90,0,.15),_0_0_30px_rgba(255,255,255,.2)]" >
                                                What you get
                                            </div>
                                            <div class="flex w-full flex-col rounded-xl border border-none border-separator bg-white/20 bg-gradient-to-b from-black/20 to-black/30 pl-3 pr-5 shadow-lg dark:bg-white/[.09]">
                                                <div class="relative flex items-start justify-center gap-2.5 pt-3">
                                                    <div class="flex size-5 shrink-0 items-center justify-center text-gray-200 font-bold tabular-nums">
                                                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path stroke-dasharray="64" stroke-dashoffset="64" d="M8 3c0.5 0 2.5 4.5 2.5 5c0 1 -1.5 2 -2 3c-0.5 1 0.5 2 1.5 3c0.39 0.39 2 2 3 1.5c1 -0.5 2 -2 3 -2c0.5 0 5 2 5 2.5c0 2 -1.5 3.5 -3 4c-1.5 0.5 -2.5 0.5 -4.5 0c-2 -0.5 -3.5 -1 -6 -3.5c-2.5 -2.5 -3 -4 -3.5 -6c-0.5 -2 -0.5 -3 0 -4.5c0.5 -1.5 2 -3 4 -3Z"><animate fill="freeze" attributeName="stroke-dashoffset" dur="0.6s" values="64;0" /><animateTransform id="lineMdPhoneCallLoop0" fill="freeze" attributeName="transform" begin="0.6s;lineMdPhoneCallLoop0.begin+2.7s" dur="0.5s" type="rotate" values="0 12 12;15 12 12;0 12 12;-12 12 12;0 12 12;12 12 12;0 12 12;-15 12 12;0 12 12" /></path><path stroke-dasharray="4" stroke-dashoffset="4" d="M15.76 8.28c-0.5 -0.51 -1.1 -0.93 -1.76 -1.24M15.76 8.28c0.49 0.49 0.9 1.08 1.2 1.72"><animate fill="freeze" attributeName="stroke-dashoffset" begin="lineMdPhoneCallLoop0.begin+0s" dur="2.7s" keyTimes="0;0.111;0.259;0.37;1" values="4;0;0;4;4" /></path><path stroke-dasharray="6" stroke-dashoffset="6" d="M18.67 5.35c-1 -1 -2.26 -1.73 -3.67 -2.1M18.67 5.35c0.99 1 1.72 2.25 2.08 3.65"><animate fill="freeze" attributeName="stroke-dashoffset" begin="lineMdPhoneCallLoop0.begin+0.2s" dur="2.7s" keyTimes="0;0.074;0.185;0.333;0.444;1" values="6;6;0;0;6;6" /></path></g></svg>
                                                    </div>
                                                    <div class="flex w-full flex-row items-center justify-start gap-0.5 border-b border-white/10 pb-3 pt-1 max-w-full truncate">
                                                        <span class="text-sm leading-tight text-white truncate max-w-full">Schedule 1-on-1 calls with the Founders</span>
                                                    </div>
                                                </div>
                                                <div class="relative flex items-start justify-center gap-2.5 pt-3">
                                                    <div class="flex size-5 shrink-0 items-center justify-center text-gray-200 font-bold tabular-nums">
                                                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 16 16"><g fill="currentColor" fill-rule="evenodd" clip-rule="evenodd"><path d="m8.427 11.073l1.205-1.205a.4.4 0 0 0 .118-.285a.8.8 0 0 0-.236-.569L8.427 7.927a.603.603 0 0 0-.854 0L6.486 9.014a.8.8 0 0 0-.236.57c0 .106.042.208.118.284l1.205 1.205a.604.604 0 0 0 .854 0" /><path d="M16 5.796v-.028a1.768 1.768 0 0 0-3.018-1.25l-.76.76l-.024.024l-.374.374l-.415.415a.335.335 0 0 1-.561-.149l-.155-.566l-.139-.51l-.009-.033l-.65-2.386a1.964 1.964 0 0 0-3.79 0l-.65 2.386l-.01.032l-.139.511l-.154.566a.335.335 0 0 1-.56.15l-.416-.416l-.374-.374l-.024-.024l-.76-.76A1.768 1.768 0 0 0 0 5.768v.028q0 .203.046.403l1.3 5.631a1.4 1.4 0 0 0 .778.958a14.02 14.02 0 0 0 11.752 0c.394-.182.681-.535.779-.958l1.299-5.63q.045-.2.046-.404M3.53 7.152c.997.997 2.698.545 3.07-.815l.952-3.495a.464.464 0 0 1 .896 0L9.4 6.337c.37 1.36 2.072 1.812 3.068.815l1.574-1.574a.268.268 0 0 1 .457.19v.028a.3.3 0 0 1-.008.066l-1.288 5.584a12.52 12.52 0 0 1-10.408 0L1.508 5.862a.3.3 0 0 1-.008-.066v-.028a.268.268 0 0 1 .457-.19z" /></g></svg>
                                                    </div>
                                                    <div class="flex w-full flex-row items-center justify-start gap-0.5 border-b border-white/10 pb-3 pt-1 max-w-full truncate">
                                                        <span class="text-sm leading-tight text-white truncate max-w-full">Keep your special early supporter pricing forever</span>
                                                    </div>
                                                </div>
                                                <div class="relative flex items-start justify-center gap-2.5 pt-3">
                                                    <div class="flex size-5 shrink-0 items-center justify-center text-gray-200 font-bold tabular-nums">
                                                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"><path d="M6.818 22v-2.857C6.662 17.592 5.633 16.416 4.682 15m9.772 7v-1.714c4.91 0 4.364-5.714 4.364-5.714s2.182 0 2.182-2.286l-2.182-3.428c0-4.572-3.709-6.816-7.636-6.857c-2.2-.023-3.957.53-5.27 1.499" /><path d="m13 7l2 2.5l-2 2.5M5 7L3 9.5L5 12m5-6l-2 7" /></g></svg>
                                                    </div>
                                                    <div class="flex w-full flex-row items-center justify-start gap-0.5 border-b border-white/10 pb-3 pt-1">
                                                        <span class="text-sm leading-tight text-white truncate max-w-full">Priority feature requests</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                        <div class="w-full justify-center items-center">
                                            <div class="mb-0.5 w-full flex items-center justify-center text-center text-sm leading-none text-gray-800" >Full access in</div>
                                            <div class="flex justify-center items-center gap-2 p-1">
                                                <TimeUnit value={timeLeft.days} label="Days" />
                                                <TimeUnit value={timeLeft.hours} label="Hours" />
                                                <TimeUnit value={timeLeft.minutes} label="Minutes" />
                                                <TimeUnit value={timeLeft.seconds} label="Seconds" />
                                            </div>
                                        </div>
                                        <div class="w-full justify-center flex">
                                            <div class="group relative w-full cursor-pointer">
                                                <button type="button" class="appearance-none outline-none scale-100 active:scale-[0.98] flex h-9 w-full shrink-0 items-center justify-center rounded-lg bg-blue-500 px-4 text-sm font-semibold text-white transition-colors disabled:pointer-events-none disabled:bg-black/70 disabled:opacity-50 group-hover:bg-blue-400">Get early supporter price</button>
                                                <div class="absolute -top-[22px] left-1/2 -translate-x-1/2">
                                                    <Icons.specialOffer />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </Modal.Panel>
            </Modal.Root>
        </main >
    )
})