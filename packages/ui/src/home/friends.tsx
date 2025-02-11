import { cn } from "../design";
import Avatar from "../avatar";
import type Nestri from "@nestri/sdk"
import { Tooltip } from '@qwik-ui/headless';
import { useNavigate } from "@builder.io/qwik-city";
import { $, component$, useOnDocument, useSignal, type QRL } from "@builder.io/qwik";

type Props = {
    getActiveUsers$: QRL<() => Promise<Nestri.Users.UserListResponse.Data[] | undefined>>
    getSession$: QRL<(profileID: string) => Promise<Nestri.Users.UserSessionResponse | undefined>>
}

const skeletonCrew = new Array(3).fill(0)

export const HomeFriendsSection = component$(({ getActiveUsers$, getSession$ }: Props) => {
    const activeUsers = useSignal<Nestri.Users.UserListResponse.Data[] | undefined>()
    const nav = useNavigate()

    useOnDocument("load", $(async () => {
        const sessionUserData = sessionStorage.getItem("active_user_data")
        if (!sessionUserData) {
            const users = await getActiveUsers$()
            sessionStorage.setItem("active_user_data", JSON.stringify(users))
            activeUsers.value = users
        } else {
            activeUsers.value = JSON.parse(sessionUserData)
        }
    }))

    const onWatch = $(async (profileID: string) => {
        const session = await getSession$(profileID)
        await nav(`/play/${session?.data.id}`)
    })

    return (
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
                    {activeUsers.value ? (
                        activeUsers.value.slice(0, 3).map((user, key) => (
                            <div key={`user-${key}`} >
                                <div class="gap-3.5 hover:bg-gray-200 dark:hover:bg-gray-800 text-left outline-none group rounded-lg px-3 [transition:all_0.3s_cubic-bezier(0.4,0,0.2,1)] flex items-center w-full">
                                    <div class="relative [&>svg]:size-[80px] [&>img]:size-[80px] min-w-[80px]">
                                        {user.avatarUrl ?
                                            (<img height={52} width={52} draggable={false} class="[transition:all_0.3s_cubic-bezier(0.4,0,0.2,1)] ring-2 ring-gray-200 dark:ring-gray-800 select-none rounded-full aspect-square w-[80px]" src={user.avatarUrl} alt={user.username} />) :
                                            (<Avatar name={`${user.username}#${user.discriminator}`} />)}
                                    </div>
                                    <div class={cn("w-full h-[100px] overflow-hidden pr-2 border-b-2 border-gray-400/70 dark:border-gray-700/70 flex gap-2 items-center", key == 2 && "border-none")}>
                                        <div class="flex-col">
                                            <span class="font-medium tracking-tighter text-gray-700 dark:text-gray-300 max-w-full text-lg truncate leading-none flex [&>svg]:size-5 [&>svg]:dark:text-[#12ECFA] ">
                                                {`${user.username}`}&nbsp;<p class="hidden group-hover:block text-gray-600/70 dark:text-gray-400/70 transition-all duration-200 ease-in">{` #${user.discriminator}`}</p>
                                                {/* &nbsp;{user.status && (user.status == "active" && (<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><path fill="currentColor" d="M10.277 16.515c.005-.11.186-.154.24-.058c.254.45.686 1.111 1.176 1.412s1.276.386 1.792.408c.11.005.153.186.057.24c-.45.254-1.11.686-1.411 1.176s-.386 1.276-.408 1.792c-.005.11-.187.153-.24.057c-.254-.45-.686-1.11-1.177-1.411c-.49-.301-1.276-.386-1.791-.408c-.11-.005-.154-.187-.058-.24c.45-.254 1.111-.686 1.412-1.177c.3-.49.386-1.276.408-1.791"/><path fill="currentColor" d="M18.492 15.515c-.009-.11-.2-.156-.258-.062c-.172.283-.42.623-.697.793s-.692.236-1.022.262c-.11.008-.156.2-.062.257c.282.172.623.42.793.697s.236.693.262 1.023c.008.11.2.155.257.061c.172-.282.42-.623.697-.792s.693-.237 1.023-.262c.11-.009.155-.2.061-.258c-.282-.172-.623-.42-.792-.697s-.237-.692-.262-1.022" opacity=".5"/><path fill="currentColor" d="m14.703 4.002l-.242-.306c-.937-1.183-1.405-1.775-1.95-1.688c-.544.088-.805.796-1.326 2.213l-.135.366c-.148.403-.222.604-.364.752s-.336.225-.724.38l-.353.141l-.247.1c-1.2.48-1.804.753-1.882 1.283c-.082.565.49 1.049 1.634 2.016l.296.25c.326.275.488.413.581.6c.094.187.107.403.133.835l.024.393c.094 1.52.14 2.28.635 2.542c.494.262 1.108-.147 2.336-.966l.318-.212c.349-.233.523-.35.723-.381s.401.024.806.136l.367.102c1.423.394 2.134.591 2.521.188c.388-.403.195-1.14-.19-2.613l-.1-.381c-.109-.419-.164-.628-.134-.835s.142-.389.366-.752l.203-.33c.785-1.276 1.178-1.914.924-2.426c-.255-.51-.988-.557-2.454-.648l-.38-.024c-.416-.026-.624-.039-.805-.135s-.314-.264-.58-.6"/><path fill="currentColor" d="M8.835 13.326C6.698 14.37 4.919 16.024 4.248 18c-.752-4.707.292-7.747 1.965-9.637c.144.295.332.539.5.73c.35.396.852.82 1.362 1.251l.367.31l.17.145c.005.064.01.14.015.237l.03.485c.04.655.08 1.294.178 1.805" opacity=".5"/></svg>))} */}
                                            </span>
                                            <div class="flex items-center gap-2 w-full cursor-pointer px-1 rounded-md">
                                                <div class={cn("font-normal capitalize w-full text-gray-600/70 dark:text-gray-400/70 truncate flex gap-1 items-center", (user.status && user.status == "active") && "dark:text-[#50e3c2]")}>
                                                    <div class={cn("size-3 rounded-full block", user.status ? (user.status == "active" ? "bg-[#50e3c2]" : user.status == "idle" ? "bg-[#ff990a]" : "hidden") : "hidden")} />
                                                    {user.status ? (user.status == "active" ? "Playing Steam" : user.status) : "Offline"}
                                                </div>
                                            </div>
                                        </div>
                                        <div class="ml-auto relative flex gap-2 justify-center h-full items-center">
                                            {user.status && (user.status == "active" &&
                                                (
                                                    <Tooltip.Root gutter={12} flip={false} placement="top" >
                                                        <Tooltip.Trigger onClick$={async () => { await onWatch(user.id) }} type="button" class="bg-gray-200 group-hover:bg-gray-300  dark:group-hover:bg-gray-700 transition-all duration-200 ease-in text-gray-600 dark:text-gray-400 dark:bg-gray-800 [&>svg]:size-5 p-2 rounded-full" >
                                                            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 16 16"><path fill="currentColor" fill-rule="evenodd" d="M4.75 5.5c.427 0 .791.163 1.075.45c-.145-.778-.37-1.415-.64-1.894C4.72 3.236 4.216 3 3.75 3s-.97.237-1.434 1.056C1.835 4.906 1.5 6.25 1.5 8s.335 3.094.816 3.944c.463.82.967 1.056 1.434 1.056s.97-.237 1.434-1.056c.272-.48.496-1.116.64-1.895a1.47 1.47 0 0 1-1.074.451C3.674 10.5 3 9.47 3 8s.674-2.5 1.75-2.5M7.5 8c0 3.822-1.445 6.5-3.75 6.5S0 11.822 0 8s1.445-6.5 3.75-6.5S7.5 4.178 7.5 8m6.825 2.05c-.145.778-.37 1.415-.64 1.894c-.464.82-.968 1.056-1.435 1.056s-.97-.237-1.434-1.056C10.335 11.094 10 9.75 10 8s.335-3.094.816-3.944C11.279 3.236 11.783 3 12.25 3s.97.237 1.434 1.056c.272.48.496 1.116.64 1.895A1.47 1.47 0 0 0 13.25 5.5c-1.076 0-1.75 1.03-1.75 2.5s.674 2.5 1.75 2.5a1.47 1.47 0 0 0 1.075-.45M16 8c0 3.822-1.445 6.5-3.75 6.5S8.5 11.822 8.5 8s1.445-6.5 3.75-6.5S16 4.178 16 8" clip-rule="evenodd" /></svg>
                                                        </Tooltip.Trigger>
                                                        <Tooltip.Panel class="tooltip capitalize text-sm relative rounded-md dark:bg-gray-700 bg-gray-300 py-2 px-3 text-gray-700 dark:text-gray-300" aria-label="More options">
                                                            Watch stream
                                                            <div class="-bottom-2 left-1/2 -translate-x-1/2 absolute dark:text-gray-700 text-gray-300" >
                                                                <svg width="15" height="10" viewBox="0 0 30 10" preserveAspectRatio="none" fill="currentColor"><polygon points="0,0 30,0 15,10"></polygon></svg>
                                                            </div>
                                                        </Tooltip.Panel>
                                                    </Tooltip.Root>
                                                ))}
                                            <Tooltip.Root gutter={12} flip={false} placement="top" >
                                                <Tooltip.Trigger disabled type="button" class="bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed group-hover:bg-gray-300  dark:group-hover:bg-gray-700 transition-all duration-200 ease-in text-gray-600 dark:text-gray-400 dark:bg-gray-800 [&>svg]:size-5 p-2 rounded-full" >
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0-8 0m8 12h6m-3-3v6M6 21v-2a4 4 0 0 1 4-4h4" /></svg>
                                                </Tooltip.Trigger>
                                                <Tooltip.Panel class="tooltip capitalize text-sm relative rounded-md dark:bg-gray-700 bg-gray-300 py-2 px-3 text-gray-700 dark:text-gray-300" aria-label="More options">
                                                    Invite
                                                    <div class="-bottom-2 left-1/2 -translate-x-1/2 absolute dark:text-gray-700 text-gray-300" >
                                                        <svg width="15" height="10" viewBox="0 0 30 10" preserveAspectRatio="none" fill="currentColor"><polygon points="0,0 30,0 15,10"></polygon></svg>
                                                    </div>
                                                </Tooltip.Panel>
                                            </Tooltip.Root>
                                            <Tooltip.Root gutter={12} flip={false} placement="top" >
                                                <Tooltip.Trigger disabled type="button" class="bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed group-hover:bg-gray-300  dark:group-hover:bg-gray-700 transition-all duration-200 ease-in text-gray-600 dark:text-gray-400 dark:bg-gray-800 [&>svg]:size-5 p-2 rounded-full" >
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><path fill="currentColor" d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2s-2 .9-2 2s.9 2 2 2m0 2c-1.1 0-2 .9-2 2s.9 2 2 2s2-.9 2-2s-.9-2-2-2m0 6c-1.1 0-2 .9-2 2s.9 2 2 2s2-.9 2-2s-.9-2-2-2" /></svg>
                                                </Tooltip.Trigger>
                                                <Tooltip.Panel class="tooltip capitalize text-sm relative rounded-md dark:bg-gray-700 bg-gray-300 py-2 px-3 text-gray-700 dark:text-gray-300" aria-label="More options">
                                                    more
                                                    <div class="-bottom-2 left-1/2 -translate-x-1/2 absolute dark:text-gray-700 text-gray-300" >
                                                        <svg width="15" height="10" viewBox="0 0 30 10" preserveAspectRatio="none" fill="currentColor"><polygon points="0,0 30,0 15,10"></polygon></svg>
                                                    </div>
                                                </Tooltip.Panel>
                                            </Tooltip.Root>
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
                    <div class="[border:1px_dashed_theme(colors.gray.300)] dark:[border:1px_dashed_theme(colors.gray.800)] [mask-image:linear-gradient(rgb(0,0,0)_0%,_rgb(0,0,0)_calc(100%-120px),_transparent_100%)] bottom-0 top-0 -left-[0.4625rem] absolute" />
                </ul>
            </div>
        </div>
    )
})