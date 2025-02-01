// import { SteamLoad, StoreSelect } from "./default";
import { Modal } from "@qwik-ui/headless";
import { $, component$, useSignal } from "@builder.io/qwik";

export default component$(() => {
    // const storeSelect = useSignal(true)
    return (
        <Modal.Root class="w-full" >
            <Modal.Trigger class="w-full border-gray-400/70 dark:border-gray-700/70 hover:ring-2 hover:ring-[#8f8f8f] dark:hover:ring-[#707070] outline-none group transition-all duration-200  border-[2px]  h-14  rounded-xl  px-4  gap-2  flex  items-center  justify-between  overflow-hidden bg-white dark:bg-black hover:bg-gray-300/70 dark:hover:bg-gray-700/70 disabled:opacity-50">
                <div class="py-2 w-2/3 flex truncate">
                    <p class="text-text-100 shrink truncate w-full flex">Instance 1</p>
                    <p class="text-text-100 shrink truncate w-full flex">4 GB</p>
                    <p class="text-text-100 shrink truncate w-full flex">2vCPU</p>
                </div>
                <div
                    style={{
                        "--cutout-avatar-percentage-visible": 0.2,
                        "--head-margin-percentage": 0.1,
                        "--size": "3rem"
                    }}
                    class="relative h-full flex w-1/3 justify-end">
                    <img draggable={false} alt="game" width={256} height={256} src="/images/steam.png" class="h-12 shadow-lg shadow-gray-900 ring-gray-400/70 ring-1 bg-black w-12 translate-y-4 rotate-[14deg] rounded-lg object-cover transition-transform sm:h-16 sm:w-16 group-hover:scale-110" />
                </div>
            </Modal.Trigger>
            <Modal.Panel
                class="dark:bg-black bg-white [box-shadow:0_8px_30px_rgba(0,0,0,.12)]
                    dark:backdrop:bg-[#0009] backdrop:bg-[#b3b5b799] backdrop:backdrop-grayscale-[.3] max-h-[75vh] rounded-xl
                    backdrop-blur-md modal max-w-[400px] w-full border dark:border-gray-800 border-gray-200">
                <main class="size-full flex flex-col relative py-4 px-5">
                    <div class="dark:text-white text-black">
                        <h3 class="font-semibold text-2xl tracking-tight mb-1 font-title">Your machine</h3>
                        <div class="text-sm dark:text-gray-200/70 text-gray-800/70" >
                            This is the machine you own, running on AWS... it comes preinstalled with Steam
                        </div>
                    </div>
                </main>
                {/* <form preventdefault:submit>

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
                                    // value={inviteName.value}
                                    //@ts-expect-error
                                    onInput$={(e) => inviteName.value = e.target!.value}
                                    id="name" type="text" placeholder="Jane Doe" class="[transition:all_0.3s_cubic-bezier(0.4,0,0.2,1)] w-full bg-transparent px-2 py-3 h-10 border text-black dark:text-white dark:border-gray-700/70 border-gray-300/70  rounded-md text-sm outline-none leading-none focus:ring-gray-300 dark:focus:ring-gray-700 focus:ring-2" />
                            </div>
                            <div>
                                <label for="email" class="text-sm dark:text-gray-200 text-gray-800 pb-2 pt-1" >
                                    Email
                                </label>
                                <input
                                    // value={inviteEmail.value}
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
                </form> */}
            </Modal.Panel>
        </Modal.Root>
    )
})