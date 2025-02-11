import { cn } from "../design";
import Avatar from "../avatar"
import type Nestri from "@nestri/sdk"
import { MotionComponent } from "../react";
import { Dropdown, Modal } from '@qwik-ui/headless';
import { useLocation, useNavigate } from "@builder.io/qwik-city";
import { disablePageScroll, enablePageScroll } from '@fluejs/noscroll';
import { $, component$, type QRL, useOnDocument, useSignal } from "@builder.io/qwik";

type Props = {
    getUserProfile$: QRL<() => Promise<Nestri.Users.UserRetrieveResponse.Data | undefined>>
}


export const HomeNavBar = component$(({ getUserProfile$ }: Props) => {
    const nav =  useNavigate()
    const inviteEmail = useSignal('');
    const location = useLocation().url
    const inviteName = useSignal('');
    const isHolding = useSignal(false);
    const newTeamName = useSignal('');
    const isNewTeam = useSignal(false);
    const hasScrolled = useSignal(false);
    const isNewMember = useSignal(false);
    const showInviteSuccess = useSignal(false);
    const userProfile = useSignal<Nestri.Users.UserRetrieveResponse.Data | undefined>()

    const onDialogOpen = $((open: boolean) => {
        if (open) {
            disablePageScroll()
        } else {
            enablePageScroll()
        }
    })

    const handlePointerDown = $(() => {
        isHolding.value = true
    });

    const handlePointerUp = $(() => {
        isHolding.value = false
    });

    const handleAddTeam = $((e: any) => {
        e.preventDefault();
        if (newTeamName.value.trim()) {
            // teams.value = [...teams.value, { name: newTeamName.value.trim() }];
            // selectedTeam.value = newTeamName.value.trim()
            newTeamName.value = '';
            isNewTeam.value = false;
        }
    });

    const handleInvite = $((e: any) => {
        e.preventDefault();
        if (inviteName.value && inviteEmail.value) {
            // Here you would typically make an API call to send the invitation
            console.log('Sending invite to:', { name: inviteName.value, email: inviteEmail.value });
            inviteName.value = '';
            inviteEmail.value = '';
            isNewMember.value = false;
            showInviteSuccess.value = true;
            setTimeout(() => {
                showInviteSuccess.value = false;
            }, 3000);
        }
    });

    useOnDocument(
        'scroll',
        $(() => {
            hasScrolled.value = window.scrollY > 0;
        })
    );

    const handleLogout = $(async() => {
        await nav(`/auth/logout`)
    });

    const handleLogoutAnimationComplete = $(() => {
        if (isHolding.value) {
            console.log("fucking hell")

            // isDeleting.value = true;
            // Reset the holding state
            isHolding.value = false;
            handleLogout();
        }
    });

    useOnDocument("load", $(async () => {
        const currentProfile = await getUserProfile$()
        userProfile.value = currentProfile
    }))

    return (
        <>
            <nav class={cn("fixed w-screen justify-between top-0 z-50 px-2 sm:px-6 text-xs sm:text-sm leading-[1] text-gray-950/70 dark:text-gray-50/70 h-[66px] before:backdrop-blur-[15px] before:absolute before:-z-[1] before:top-0 before:left-0 before:w-full before:h-full flex items-center", hasScrolled.value && "shadow-[0_2px_20px_1px] shadow-gray-300 dark:shadow-gray-700")} >
                <div class="flex flex-row justify-center relative items-center top-0 bottom-0">
                    <div class="flex-shrink-0 gap-2 flex justify-center items-center">
                        <svg
                            class="size-8 "
                            width="100%"
                            height="100%"
                            viewBox="0 0 12.8778 9.7377253"
                            version="1.1"
                            id="svg1"
                            xmlns="http://www.w3.org/2000/svg">
                            <path
                                d="m 2.093439,1.7855532 h 8.690922 V 2.2639978 H 2.093439 Z m 0,2.8440874 h 8.690922 V 5.1080848 H 2.093439 Z m 0,2.8440866 h 8.690922 V 7.952172 H 2.093439 Z"
                                style="font-size:12px;fill:#ff4f01;fill-opacity:1;fill-rule:evenodd;stroke:#ff4f01;stroke-width:1.66201;stroke-linecap:round;stroke-dasharray:none;stroke-opacity:1" />
                        </svg>
                    </div>
                    <div class="relative z-[5] items-center flex">
                        <hr class="dark:bg-gray-700/70 bg-gray-400/70 w-0.5 rounded-md mx-3 rotate-[16deg] h-7 border-none" />
                        {userProfile.value ? (
                            <Dropdown.Root class="animate-fade-in opacity-0 transition-all duration-200 ease-in" onOpenChange$={onDialogOpen}>
                                <Dropdown.Trigger class="text-sm [&>svg:first-child]:size-5 rounded-full h-8 focus:bg-gray-300/70 dark:focus:bg-gray-700/70 focus:ring-[#8f8f8f] dark:focus:ring-[#707070] focus:ring-2 outline-none dark:text-gray-400 text-gray-600 gap-2 px-3 cursor-pointer inline-flex transition-all duration-150 items-center hover:bg-gray-300/70 dark:hover:bg-gray-700/70 ">
                                    <Avatar name={`${userProfile.value.username}'s Games`} />
                                    <span class="truncate shrink max-w-[20ch]">{`${userProfile.value.username}'s Games`}</span>
                                    <svg xmlns="http://www.w3.org/2000/svg" class="size-4" width="32" height="32" viewBox="0 0 256 256"><path fill="currentColor" d="M72.61 83.06a8 8 0 0 1 1.73-8.72l48-48a8 8 0 0 1 11.32 0l48 48A8 8 0 0 1 176 88H80a8 8 0 0 1-7.39-4.94M176 168H80a8 8 0 0 0-5.66 13.66l48 48a8 8 0 0 0 11.32 0l48-48A8 8 0 0 0 176 168" /></svg>
                                </Dropdown.Trigger>
                                <Dropdown.Popover
                                    class="bg-[hsla(0,0%,100%,.5)] dark:bg-[hsla(0,0%,100%,.026)] min-w-[160px] max-w-[240px] backdrop-blur-md rounded-lg py-1 px-2 border border-[#e8e8e8] dark:border-[#2e2e2e] [box-shadow:0_8px_30px_rgba(0,0,0,.12)]">
                                    <Dropdown.RadioGroup class="w-full flex overflow-hidden flex-col gap-1 [&_*]:w-full [&_[data-checked]]:bg-[rgba(0,0,0,.071)] dark:[&_[data-checked]]:bg-[hsla(0,0%,100%,.077)] [&_[data-checked]]:rounded-md [&_[data-checked]]:text-[#171717] [&_[data-checked]_svg]:block cursor-pointer [&_[data-highlighted]]:text-[#171717] dark:[&_[data-checked]]:text-[#ededed] dark:[&_[data-highlighted]]:text-[#ededed] [&_[data-highlighted]]:bg-[rgba(0,0,0,.071)] dark:[&_[data-highlighted]]:bg-[hsla(0,0%,100%,.077)] [&_[data-highlighted]]:rounded-md">
                                        <Dropdown.RadioItem
                                            value={`${userProfile.value.username}'s Games`}
                                            class="leading-none text-sm items-center flex px-2 h-8 rounded-md outline-none relative select-none w-full"
                                        >
                                            <span class="w-full max-w-[20ch] flex items-center gap-2 truncate [&>svg]:size-5 text-[#6f6f6f] dark:text-[#a0a0a0]">
                                                <Avatar class="flex-shrink-0 rounded-full" name={`${userProfile.value.username}'s Games`} />
                                                {`${userProfile.value.username}'s Games`}
                                            </span>
                                            <span class="py-1 px-1 text-primary-500 [&>svg]:size-5 [&>svg]:hidden !w-max" >
                                                <svg xmlns="http://www.w3.org/2000/svg" class="" viewBox="0 0 24 24"><path fill="currentColor" d="m10 13.6l5.9-5.9q.275-.275.7-.275t.7.275t.275.7t-.275.7l-6.6 6.6q-.3.3-.7.3t-.7-.3l-2.6-2.6q-.275-.275-.275-.7t.275-.7t.7-.275t.7.275z" /></svg>
                                            </span>
                                        </Dropdown.RadioItem>
                                    </Dropdown.RadioGroup>
                                    <Dropdown.Separator class="w-full dark:bg-[#2e2e2e] bg-[#e8e8e8] border-0 h-[1px] my-1" />
                                    <Dropdown.Group class="flex flex-col gap-1 w-full">
                                        <Dropdown.Item
                                            onClick$={() => isNewTeam.value = true}
                                            class={cn("leading-none w-full text-sm items-center text-[#6f6f6f] dark:text-[#a0a0a0] hover:text-[#171717] dark:hover:text-[#ededed] hover:bg-[rgba(0,0,0,.071)] dark:hover:bg-[hsla(0,0%,100%,.077)] flex px-2 gap-2 h-8 rounded-md cursor-pointer outline-none relative", "opacity-50 pointer-events-none !cursor-not-allowed")}
                                        >
                                            <span class="w-full max-w-[20ch] flex items-center gap-2 truncate overflow-visible [&>svg]:size-5">
                                                <svg xmlns="http://www.w3.org/2000/svg" class="flex-shrink-0" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v14m-7-7h14" /></svg>
                                                New Team
                                            </span>
                                        </Dropdown.Item>
                                        <Dropdown.Item
                                            // onClick$={() => isNewMember.value = true}
                                            class={cn("leading-none w-full text-sm items-center text-[#6f6f6f] dark:text-[#a0a0a0] hover:text-[#171717] dark:hover:text-[#ededed] hover:bg-[rgba(0,0,0,.071)] dark:hover:bg-[hsla(0,0%,100%,.077)] flex px-2 gap-2 h-8 rounded-md cursor-pointer outline-none relative", "opacity-50 pointer-events-none !cursor-not-allowed")}
                                        >
                                            <span class="w-full max-w-[20ch] flex items-center gap-2 truncate overflow-visible [&>svg]:size-5">
                                                <svg xmlns="http://www.w3.org/2000/svg" class="flex-shrink-0" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7a4 4 0 1 0 8 0a4 4 0 0 0-8 0m8 12h6m-3-3v6M6 21v-2a4 4 0 0 1 4-4h4" /></svg>
                                                Send an invite
                                            </span>
                                        </Dropdown.Item>
                                        <button
                                            onPointerDown$={handlePointerDown}
                                            onPointerUp$={handlePointerUp}
                                            onPointerLeave$={handlePointerUp}
                                            onKeyDown$={(e) => e.key === "Enter" && handlePointerDown()}
                                            onKeyUp$={(e) => e.key === "Enter" && handlePointerUp()}
                                            disabled={true}
                                            class={cn("leading-none relative overflow-hidden transition-all duration-200 text-sm group items-center text-red-500 [&>*]:w-full [&>qwik-react]:absolute [&>qwik-react]:h-full [&>qwik-react]:left-0 hover:text-[#171717] dark:hover:text-[#ededed] hover:bg-[rgba(0,0,0,.071)] dark:hover:bg-[hsla(0,0%,100%,.077)] flex px-2 gap-2 h-8 rounded-md cursor-pointer outline-none select-none w-full", "opacity-50 pointer-events-none !cursor-not-allowed")}>
                                            <MotionComponent
                                                client:load
                                                class="absolute left-0 top-0 bottom-0 bg-red-500 opacity-50 w-full h-full rounded-md"
                                                initial={{ scaleX: 0 }}
                                                animate={{
                                                    scaleX: isHolding.value ? 1 : 0
                                                }}
                                                style={{
                                                    transformOrigin: 'left',
                                                }}
                                                transition={{
                                                    duration: isHolding.value ? 2 : 0.5,
                                                    ease: "linear"
                                                }}
                                            />
                                            <span class="w-full max-w-[20ch] flex items-center gap-2 truncate overflow-visible [&>svg]:size-5 ">
                                                <svg xmlns="http://www.w3.org/2000/svg" class="flex-shrink-0" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="m19.5 5.5l-.402 6.506M4.5 5.5l.605 10.025c.154 2.567.232 3.85.874 4.774c.317.456.726.842 1.2 1.131c.671.41 1.502.533 2.821.57m10-7l-7 7m7 0l-7-7M3 5.5h18m-4.944 0l-.683-1.408c-.453-.936-.68-1.403-1.071-1.695a2 2 0 0 0-.275-.172C13.594 2 13.074 2 12.035 2c-1.066 0-1.599 0-2.04.234a2 2 0 0 0-.278.18c-.395.303-.616.788-1.058 1.757L8.053 5.5" color="currentColor" /></svg>
                                                <span class="group-hover:hidden">Delete Team</span>
                                                <span class="hidden group-hover:block">Hold to delete</span>
                                            </span>
                                        </button>
                                    </Dropdown.Group>
                                </Dropdown.Popover>
                            </Dropdown.Root>) : (<div class="h-6 w-40 rounded-md bg-gray-200 dark:bg-gray-800 animate-pulse" />)}
                        {location.pathname == "/machine" &&
                            (<>
                                <hr class="dark:bg-gray-700/70 bg-gray-400/70 w-0.5 rounded-md mx-3 rotate-[16deg] h-7 border-none" />
                                {userProfile.value ? (
                                <div class="text-sm [&>svg:first-child]:size-5 rounded-full h-8 focus:bg-gray-300/70 dark:focus:bg-gray-700/70 focus:ring-[#8f8f8f] dark:focus:ring-[#707070] focus:ring-2 outline-none dark:text-gray-400 text-gray-600 gap-2 px-3 cursor-pointer inline-flex transition-all duration-150 items-center hover:bg-gray-300/70 dark:hover:bg-gray-700/70 ">
                                    <span class="truncate shrink max-w-[20ch]">{`Steam Machine`}</span>
                                    <svg xmlns="http://www.w3.org/2000/svg" class="size-4" width="32" height="32" viewBox="0 0 256 256"><path fill="currentColor" d="M72.61 83.06a8 8 0 0 1 1.73-8.72l48-48a8 8 0 0 1 11.32 0l48 48A8 8 0 0 1 176 88H80a8 8 0 0 1-7.39-4.94M176 168H80a8 8 0 0 0-5.66 13.66l48 48a8 8 0 0 0 11.32 0l48-48A8 8 0 0 0 176 168" /></svg>
                                </div>
                                ) : (<div class="h-6 w-40 rounded-md bg-gray-200 dark:bg-gray-800 animate-pulse" />)}
                            </>
                            )
                        }
                    </div>
                </div>
                <div class="gap-4 flex flex-row justify-center h-full items-center">
                    {userProfile.value ?
                        (<Dropdown.Root class="animate-fade-in opacity-0 transition-all duration-200 ease-in" onOpenChange$={onDialogOpen}>
                            <Dropdown.Trigger class="focus:bg-gray-300/70 dark:focus:bg-gray-700/70 focus:ring-[#8f8f8f] dark:focus:ring-[#707070] text-gray-600 dark:text-gray-400 [&>svg:first-child]:size-5 text-sm focus:ring-2 outline-none rounded-full transition-all flex items-center duration-150 select-none cursor-pointer hover:bg-gray-300/70 dark:hover:bg-gray-700/70 gap-1 px-3 h-8" >
                                {userProfile.value.avatarUrl ? (<img src={userProfile.value.avatarUrl} height={20} width={20} class="size-6 rounded-full" alt="Avatar" />) : (<Avatar name={`${userProfile.value.username}#${userProfile.value.discriminator}`} />)}
                                <span class="truncate shrink max-w-[20ch] sm:flex hidden">{`${userProfile.value.username}#${userProfile.value.discriminator}`}</span>
                                <svg xmlns="http://www.w3.org/2000/svg" class="size-4 sm:block hidden" width="32" height="32" viewBox="0 0 256 256"><path fill="currentColor" d="M72.61 83.06a8 8 0 0 1 1.73-8.72l48-48a8 8 0 0 1 11.32 0l48 48A8 8 0 0 1 176 88H80a8 8 0 0 1-7.39-4.94M176 168H80a8 8 0 0 0-5.66 13.66l48 48a8 8 0 0 0 11.32 0l48-48A8 8 0 0 0 176 168" /></svg>
                            </Dropdown.Trigger>
                            <Dropdown.Popover
                                class="bg-[hsla(0,0%,100%,.5)] dark:bg-[hsla(0,0%,100%,.026)] min-w-[160px] max-w-[240px] backdrop-blur-md rounded-lg py-1 px-2 border border-[#e8e8e8] dark:border-[#2e2e2e] [box-shadow:0_8px_30px_rgba(0,0,0,.12)]">
                                <Dropdown.Group class="flex flex-col gap-1">
                                    <Dropdown.Item
                                        onClick$={() => window.location.href = "mailto:feedback@nestri.io"}
                                        class="leading-none text-sm items-center text-[#6f6f6f] dark:text-[#a0a0a0] hover:text-[#171717] dark:hover:text-[#ededed] hover:bg-[rgba(0,0,0,.071)] dark:hover:bg-[hsla(0,0%,100%,.077)] flex px-2 gap-2 h-8 rounded-md cursor-pointer outline-none relative select-none  "
                                    >
                                        <span class="w-full max-w-[20ch] flex items-center gap-2 truncate overflow-visible [&>svg]:size-5 ">
                                            <svg xmlns="http://www.w3.org/2000/svg" class="flex-shrink-0" viewBox="0 0 24 24"><path fill="currentColor" d="M22 8.5a6.5 6.5 0 0 0-11.626-3.993A9.5 9.5 0 0 1 19.5 14q0 .165-.006.33l.333.088a1.3 1.3 0 0 0 1.592-1.591l-.128-.476c-.103-.385-.04-.791.125-1.153A6.5 6.5 0 0 0 22 8.5" /><path fill="currentColor" fill-rule="evenodd" d="M18 14a8 8 0 0 1-11.45 7.22a1.67 1.67 0 0 0-1.15-.13l-1.227.329a1.3 1.3 0 0 1-1.591-1.592L2.91 18.6a1.67 1.67 0 0 0-.13-1.15A8 8 0 1 1 18 14M6.5 15a1 1 0 1 0 0-2a1 1 0 0 0 0 2m3.5 0a1 1 0 1 0 0-2a1 1 0 0 0 0 2m3.5 0a1 1 0 1 0 0-2a1 1 0 0 0 0 2" clip-rule="evenodd" /></svg>
                                            Send Feedback
                                        </span>
                                    </Dropdown.Item>
                                    {/* <button
                                        onPointerDown$={handlePointerDown}
                                        onPointerUp$={handlePointerUp}
                                        onPointerLeave$={handlePointerUp}
                                        onKeyDown$={(e) => e.key === "Enter" && handlePointerDown()}
                                        onKeyUp$={(e) => e.key === "Enter" && handlePointerUp()}
                                        class="leading-none relative overflow-hidden transition-all duration-200 text-sm group items-center text-red-500 [&>*]:w-full [&>qwik-react]:absolute [&>qwik-react]:h-full [&>qwik-react]:left-0 hover:text-[#171717] dark:hover:text-[#ededed] hover:bg-[rgba(0,0,0,.071)] dark:hover:bg-[hsla(0,0%,100%,.077)] flex px-2 gap-2 h-8 rounded-md cursor-pointer outline-none select-none w-full">
                                        <MotionComponent
                                            client:load
                                            class="absolute left-0 top-0 bottom-0 bg-red-500 opacity-50 w-full h-full rounded-md"
                                            initial={{ scaleX: 0 }}
                                            animate={{
                                                scaleX: isHolding.value ? 1 : 0
                                            }}
                                            style={{
                                                transformOrigin: 'left',
                                            }}
                                            transition={{
                                                duration: isHolding.value ? 2 : 0.5,
                                                ease: "linear"
                                            }}
                                            onAnimationComplete$={handleLogoutAnimationComplete}
                                        />
                                        <span class="w-full max-w-[20ch] flex items-center gap-2 truncate overflow-visible [&>svg]:size-5 ">
                                            <svg xmlns="http://www.w3.org/2000/svg" class="flex-shrink-0" viewBox="0 0 24 24"><g fill="none"><path fill="currentColor" fill-rule="evenodd" d="M10.138 1.815A3 3 0 0 1 14 4.688v14.624a3 3 0 0 1-3.862 2.873l-6-1.8A3 3 0 0 1 2 17.512V6.488a3 3 0 0 1 2.138-2.873zM15 4a1 1 0 0 1 1-1h3a3 3 0 0 1 3 3v1a1 1 0 1 1-2 0V6a1 1 0 0 0-1-1h-3a1 1 0 0 1-1-1m6 12a1 1 0 0 1 1 1v1a3 3 0 0 1-3 3h-3a1 1 0 1 1 0-2h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1M9 11a1 1 0 1 0 0 2h.001a1 1 0 1 0 0-2z" clip-rule="evenodd" /><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 12h5m0 0l-2-2m2 2l-2 2" /></g></svg>
                                            <span class="group-hover:hidden">Log out</span>
                                            <span class="hidden group-hover:block">Hold to logout</span>
                                        </span>
                                    </button> */}
                                    <button
                                        onPointerDown$={handlePointerDown}
                                        onPointerUp$={handlePointerUp}
                                        onPointerLeave$={handlePointerUp}
                                        onKeyDown$={(e) => e.key === "Enter" && handlePointerDown()}
                                        onKeyUp$={(e) => e.key === "Enter" && handlePointerUp()}
                                        class={cn("leading-none relative overflow-hidden transition-all duration-200 text-sm group items-center text-red-500 [&>*]:w-full [&>qwik-react]:absolute [&>qwik-react]:h-full [&>qwik-react]:left-0 hover:text-[#171717] dark:hover:text-[#ededed] hover:bg-[rgba(0,0,0,.071)] dark:hover:bg-[hsla(0,0%,100%,.077)] flex px-2 gap-2 h-8 rounded-md cursor-pointer outline-none select-none w-full")}>
                                        <MotionComponent
                                            client:load
                                            class="absolute left-0 top-0 bottom-0 bg-red-500 opacity-50 w-full h-full rounded-md"
                                            initial={{ scaleX: 0 }}
                                            animate={{
                                                scaleX: isHolding.value ? 1 : 0
                                            }}
                                            style={{
                                                transformOrigin: 'left',
                                            }}
                                            transition={{
                                                duration: isHolding.value ? 2 : 0.5,
                                                ease: "linear"
                                            }}
                                            onAnimationComplete$={handleLogoutAnimationComplete}
                                        />
                                        <span class="w-full max-w-[20ch] flex items-center gap-2 truncate overflow-visible [&>svg]:size-5 ">
                                            <svg xmlns="http://www.w3.org/2000/svg" class="flex-shrink-0" viewBox="0 0 24 24"><g fill="none"><path fill="currentColor" fill-rule="evenodd" d="M10.138 1.815A3 3 0 0 1 14 4.688v14.624a3 3 0 0 1-3.862 2.873l-6-1.8A3 3 0 0 1 2 17.512V6.488a3 3 0 0 1 2.138-2.873zM15 4a1 1 0 0 1 1-1h3a3 3 0 0 1 3 3v1a1 1 0 1 1-2 0V6a1 1 0 0 0-1-1h-3a1 1 0 0 1-1-1m6 12a1 1 0 0 1 1 1v1a3 3 0 0 1-3 3h-3a1 1 0 1 1 0-2h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1M9 11a1 1 0 1 0 0 2h.001a1 1 0 1 0 0-2z" clip-rule="evenodd" /><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 12h5m0 0l-2-2m2 2l-2 2" /></g></svg>
                                            <span class="group-hover:hidden">Log out</span>
                                            <span class="hidden group-hover:block">Hold to logout</span>
                                        </span>
                                    </button>
                                </Dropdown.Group>
                                {/* <Dropdown.Separator class="w-full dark:bg-[#2e2e2e] bg-[#e8e8e8] border-0 h-[1px] my-1" />
                                <Dropdown.Group class="flex flex-col gap-1">
                                    <Dropdown.Item
                                        class="leading-none transition-all duration-200 text-sm group items-center text-red-500 hover:text-[#171717] dark:hover:text-[#ededed] hover:bg-[rgba(0,0,0,.071)] dark:hover:bg-[hsla(0,0%,100%,.077)] flex px-2 gap-2 h-8 rounded-md cursor-pointer outline-none relative select-none  "
                                    >
                                        <span class="w-full max-w-[20ch] flex items-center gap-2 truncate overflow-visible [&>svg]:size-5 ">
                                            <svg xmlns="http://www.w3.org/2000/svg" class="flex-shrink-0" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13 22H6.59c-1.545 0-2.774-.752-3.877-1.803c-2.26-2.153 1.45-3.873 2.865-4.715a10.67 10.67 0 0 1 7.922-1.187m3-7.795a4.5 4.5 0 1 1-9 0a4.5 4.5 0 0 1 9 0M16 22l3-3m0 0l3-3m-3 3l-3-3m3 3l3 3" color="currentColor" /></svg>
                                            <span class="group-hover:hidden">Leave Team</span>
                                            <span class="hidden group-hover:block">Hold to leave</span>
                                        </span>
                                    </Dropdown.Item>
                                </Dropdown.Group> */}
                            </Dropdown.Popover>
                        </Dropdown.Root>) :
                        (<div class="flex gap-2 justify-center items-center animate-pulse " >
                            <div class="h-6 w-20 rounded-md bg-gray-200 dark:bg-gray-800 right-4" />
                            <div class="size-8 rounded-full bg-gray-200 dark:bg-gray-800 right-4" />
                        </div>)
                    }
                </div>
            </nav>
            <Modal.Root bind:show={isNewTeam} class="w-full">
                <Modal.Panel
                    class="dark:bg-black bg-white [box-shadow:0_8px_30px_rgba(0,0,0,.12)]
                    dark:backdrop:bg-[#0009] backdrop:bg-[#b3b5b799] backdrop:backdrop-grayscale-[.3] max-h-[75vh] rounded-xl
                    backdrop-blur-md modal max-w-[400px] w-full border dark:border-gray-800 border-gray-200">
                    <form preventdefault:submit onSubmit$={handleAddTeam}>
                        <main class="size-full flex flex-col relative py-4 px-5">
                            <div class="dark:text-white text-black">
                                <h3 class="font-semibold text-2xl tracking-tight mb-1 font-title">Create a team</h3>
                                <div class="text-sm dark:text-gray-200/70 text-gray-800/70" >
                                    Continue to start playing with on Pro with increased usage, additional security features, and support
                                </div>
                            </div>
                            <div class="mt-3 flex flex-col gap-3" >
                                <div>
                                    <label for="name" class="text-sm dark:text-gray-200 text-gray-800 pb-2 pt-1" >
                                        Team Name
                                    </label>
                                    <input
                                        //@ts-expect-error
                                        onInput$={(e) => newTeamName.value = e.target!.value}
                                        required value={newTeamName.value} id="name" type="text" placeholder="Enter team name" class="[transition:all_0.3s_cubic-bezier(0.4,0,0.2,1)] w-full bg-transparent px-2 py-3 h-10 border text-black dark:text-white dark:border-gray-700/70 border-gray-300/70  rounded-md text-sm outline-none leading-none focus:ring-gray-300 dark:focus:ring-gray-700 focus:ring-2" />
                                </div>
                            </div>
                        </main>
                        <footer class="dark:text-gray-200/70 text-gray-800/70 dark:bg-gray-900 bg-gray-100 ring-1 ring-gray-200 dark:ring-gray-800 select-none flex gap-2 items-center justify-between w-full bottom-0 left-0 py-3 px-5 text-sm leading-none">
                            <Modal.Close class="rounded-lg [transition:all_0.3s_cubic-bezier(0.4,0,0.2,1)] py-3 px-4  hover:bg-gray-200 dark:hover:bg-gray-800 flex items-center justify-center">
                                Cancel
                            </Modal.Close>
                            <button
                                type="submit"
                                class="flex items-center justify-center gap-2 border-2 border-gray-300 dark:border-gray-700 rounded-lg bg-gray-200 dark:bg-gray-800 py-3 px-4 hover:bg-gray-300 dark:hover:bg-gray-700 [transition:all_0.3s_cubic-bezier(0.4,0,0.2,1)]" >
                                Continue
                            </button>
                        </footer>
                    </form>
                </Modal.Panel>
            </Modal.Root >
            <Modal.Root bind:show={isNewMember} class="w-full">
                <Modal.Panel
                    class="dark:bg-black bg-white [box-shadow:0_8px_30px_rgba(0,0,0,.12)]
                    dark:backdrop:bg-[#0009] backdrop:bg-[#b3b5b799] backdrop:backdrop-grayscale-[.3] max-h-[75vh] rounded-xl
                    backdrop-blur-md modal max-w-[400px] w-full border dark:border-gray-800 border-gray-200">
                    <form preventdefault:submit onSubmit$={handleInvite}>

                        <main class="size-full flex flex-col relative py-4 px-5">
                            <div class="dark:text-white text-black">
                                <h3 class="font-semibold text-2xl tracking-tight mb-1 font-title">Send an invite</h3>
                                <div class="text-sm dark:text-gray-200/70 text-gray-800/70" >
                                    Friends will receive an email allowing them to join this team
                                </div>
                            </div>
                            <div class="mt-3 flex flex-col gap-3" >
                                <div>
                                    <label for="name" class="text-sm dark:text-gray-200 text-gray-800 pb-2 pt-1" >
                                        Name
                                    </label>
                                    <input
                                        value={inviteName.value}
                                        //@ts-expect-error
                                        onInput$={(e) => inviteName.value = e.target!.value}
                                        id="name" type="text" placeholder="Jane Doe" class="[transition:all_0.3s_cubic-bezier(0.4,0,0.2,1)] w-full bg-transparent px-2 py-3 h-10 border text-black dark:text-white dark:border-gray-700/70 border-gray-300/70  rounded-md text-sm outline-none leading-none focus:ring-gray-300 dark:focus:ring-gray-700 focus:ring-2" />
                                </div>
                                <div>
                                    <label for="email" class="text-sm dark:text-gray-200 text-gray-800 pb-2 pt-1" >
                                        Email
                                    </label>
                                    <input
                                        value={inviteEmail.value}
                                        //@ts-expect-error
                                        onInput$={(e) => inviteEmail.value = e.target!.value}
                                        id="email" type="email" placeholder="jane@doe.com" class="[transition:all_0.3s_cubic-bezier(0.4,0,0.2,1)] w-full px-2 bg-transparent py-3 h-10 border text-black dark:text-white dark:border-gray-700/70 border-gray-300/70 rounded-md text-sm outline-none leading-none focus:ring-gray-300 dark:focus:ring-gray-700 focus:ring-2" />
                                </div>
                            </div>
                        </main>
                        <footer class="dark:text-gray-200/70 text-gray-800/70 dark:bg-gray-900 bg-gray-100 ring-1 ring-gray-200 dark:ring-gray-800 select-none flex gap-2 items-center justify-between w-full bottom-0 left-0 py-3 px-5 text-sm leading-none">
                            <Modal.Close class="rounded-lg [transition:all_0.3s_cubic-bezier(0.4,0,0.2,1)] py-3 px-4  hover:bg-gray-200 dark:hover:bg-gray-800 flex items-center justify-center">
                                Cancel
                            </Modal.Close>
                            <button type="submit" class="flex items-center justify-center gap-2 border-2 border-gray-300 dark:border-gray-700 rounded-lg bg-gray-200 dark:bg-gray-800 py-3 px-4 hover:bg-gray-300 dark:hover:bg-gray-700 [transition:all_0.3s_cubic-bezier(0.4,0,0.2,1)]" >
                                Send an invite
                            </button>
                        </footer>
                    </form>
                </Modal.Panel>
            </Modal.Root>
        </>
    )
})