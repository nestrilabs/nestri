import { cn } from "@/design";
import type Nestri from "@nestri/sdk"
import { $, component$, useOnDocument, useSignal, type QRL } from "@builder.io/qwik";
import Avatar from "@/avatar";

type Props = {
    getActiveUsers$: QRL<() => Promise<Nestri.Users.UserListResponse.Data[] | undefined>>
}

const skeletonCrew = new Array(3).fill(0)

export const HomeFriendsSection = component$(({ getActiveUsers$ }: Props) => {
    const activeUsers = useSignal<Nestri.Users.UserListResponse.Data[] | undefined>()

    useOnDocument("load", $(async () => {
        const users = await getActiveUsers$()
        activeUsers.value = users
    }))

    return (
        <ul class="list-none ml-4 relative w-[calc(100%-1rem)]">
            {activeUsers.value ? (
                activeUsers.value.slice(0, 3).map((user, key) => (
                    <div key={`user-${key}`} >
                        <div class="gap-3.5 hover:bg-gray-200 dark:hover:bg-gray-800 text-left outline-none group rounded-lg px-3 [transition:all_0.3s_cubic-bezier(0.4,0,0.2,1)] flex items-center w-full">
                            <div class="relative [&>svg]:size-[80px] w-max">
                                {user.avatarUrl ?
                                    (<img height={52} width={52} draggable={false} class="[transition:all_0.3s_cubic-bezier(0.4,0,0.2,1)] ring-2 ring-gray-200 dark:ring-gray-800 select-none rounded-full aspect-square w-[80px]" src={user.avatarUrl} alt={user.username} />) :
                                    (<Avatar name={`${user.username}#${user.discriminator}`} />)}
                                <div class="size-1/4 min-w-1.5 min-h-1.5 rounded-full bg-gray-100 dark:bg-gray-900 absolute right-0 bottom-0 overflow-hidden [&>svg]:size-10 flex justify-center items-center">
                                    <div style={{ "--border": "max(3px,10%)" }} class={cn("m-[--border]  rounded-full size-[calc(100%-2*var(--border))]", user.status && (user.status == "active" ? "bg-[#50e3c2]" : user.status == "idle" ? "bg-[#ff990a]" : "bg-gray-500"))} />
                                </div>
                            </div>
                            <div class={cn("w-full h-[100px] overflow-hidden pr-2 border-b-2 border-gray-400/70 dark:border-gray-700/70 flex gap-2 items-center", key == 2 && "border-none")}>
                                <div class="flex-col">
                                    <span class="font-medium tracking-tighter text-gray-700 dark:text-gray-300 max-w-full text-lg truncate leading-none flex">
                                        {`${user.username}`}&nbsp;<p class="hidden group-hover:block text-gray-600/70 dark:text-gray-400/70 transition-all duration-200 ease-in">{` #${user.discriminator}`}</p>
                                    </span>
                                    <div class="flex items-center gap-2 w-full cursor-pointer px-1 rounded-md">
                                        <div class="font-normal capitalize w-full text-gray-600/70 dark:text-gray-400/70 truncate flex gap-1 items-center">
                                            {user.status ? user.status : "Offline"}
                                        </div>
                                    </div>
                                </div>
                                <div class="ml-auto relative flex gap-2 justify-center h-full items-center">
                                    <button class="bg-gray-200 group-hover:bg-gray-300  dark:group-hover:bg-gray-700 transition-all duration-200 ease-in text-gray-800 dark:text-gray-200 dark:bg-gray-800 [&>svg]:size-5 p-2 rounded-full" >
                                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0-8 0m8 12h6m-3-3v6M6 21v-2a4 4 0 0 1 4-4h4" /></svg>
                                    </button>
                                    <button class="bg-gray-200 group-hover:bg-gray-300  dark:group-hover:bg-gray-700 transition-all duration-200 ease-in text-gray-800 dark:text-gray-200 dark:bg-gray-800 [&>svg]:size-5 p-2 rounded-full" >
                                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><path fill="currentColor" d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2s-2 .9-2 2s.9 2 2 2m0 2c-1.1 0-2 .9-2 2s.9 2 2 2s2-.9 2-2s-.9-2-2-2m0 6c-1.1 0-2 .9-2 2s.9 2 2 2s2-.9 2-2s-.9-2-2-2" /></svg>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                ))
            ) :
                (
                    skeletonCrew.map((_, key) => (
                        <div key={`skeleton-friend-${key}`} >
                            <div class="gap-3.5 text-left animate-pulse outline-none group rounded-lg px-3 [transition:all_0.3s_cubic-bezier(0.4,0,0.2,1)] flex items-center w-full">
                                <div class="relative w-max">
                                    <div class="size-20 rounded-full bg-gray-200 dark:bg-gray-800" />
                                </div>
                                <div class={cn("w-full h-[100px] overflow-hidden pr-2 border-b-2 border-gray-400/70 dark:border-gray-700/70 flex gap-2 items-center", key == 2 && "border-none")}>
                                    <div class="flex-col w-[80%] gap-2 flex">
                                        <span class="font-medium tracking-tighter bg-gray-200 dark:bg-gray-800 rounded-md h-6 w-2/3 max-w-full text-lg font-title truncate leading-none block" />
                                        <div class="flex items-center gap-2 w-full h-6 bg-gray-200 dark:bg-gray-800 rounded-md" />
                                    </div>
                                    <div class="bg-gray-200 dark:bg-gray-800 h-7 w-16 ml-auto rounded-md" />
                                </div>
                            </div>
                        </div>
                    ))
                )
            }
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
    )
})