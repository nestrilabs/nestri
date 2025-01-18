import { SteamLoad, StoreSelect } from "./default";
import { Modal } from "@qwik-ui/headless";
import { $, component$, useSignal } from "@builder.io/qwik";

export default component$(() => {
    const storeSelect = useSignal(true)
    return (
        <Modal.Root class="w-full" >
            <Modal.Trigger class="w-full border-gray-400/70 dark:border-gray-700/70 hover:ring-2 hover:ring-[#8f8f8f] dark:hover:ring-[#707070] outline-none group transition-all duration-200  border-[2px]  h-14  rounded-xl  px-4  gap-2  flex  items-center  justify-between  overflow-hidden bg-white dark:bg-black hover:bg-gray-300/70 dark:hover:bg-gray-700/70 disabled:opacity-50">
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
                    <img draggable={false} alt="game" width={256} height={256} src="/images/steam.png" class="h-12 shadow-lg shadow-gray-900 ring-gray-400/70 ring-1 bg-black w-12 translate-y-4 rotate-[14deg] rounded-lg object-cover transition-transform sm:h-16 sm:w-16 group-hover:scale-110" />
                </div>
            </Modal.Trigger>
            <Modal.Panel class="
                        dark:backdrop:bg-[#0009] backdrop:bg-[#b3b5b799] backdrop:backdrop-grayscale-[.3] w-full max-w-[360px] max-h-[75vh] rounded-[28px] border dark:border-[#191918] border-[#e2e2e2]
                            dark:[box-shadow:0_0_0_1px_rgba(255,255,255,0.08),_0_3.3px_2.7px_rgba(0,0,0,.1),0_8.3px_6.9px_rgba(0,0,0,.13),0_17px_14.2px_rgba(0,0,0,.17),0_35px_29.2px_rgba(0,0,0,.22),0px_-4px_4px_0px_rgba(0,0,0,.04)_inset] dark:bg-[#111110] 
                            [box-shadow:0_0_0_1px_rgba(19,21,23,0.08),_0_3.3px_2.7px_rgba(0,0,0,.03),0_8.3px_6.9px_rgba(0,0,0,.04),0_17px_14.2px_rgba(0,0,0,.05),0_35px_29.2px_rgba(0,0,0,.06),0px_-4px_4px_0px_rgba(0,0,0,.07)_inset] bg-[#fdfdfc] 
                            backdrop-blur-lg modal" >
                <div class="size-full flex flex-col relative text-gray-800 dark:text-gray-200">
                    {storeSelect.value ? <StoreSelect onSteamPress$={$(() => { console.log("clicked") })} /> : <SteamLoad />}
                </div>
            </Modal.Panel>
        </Modal.Root>
    )
})