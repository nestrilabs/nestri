import { component$ } from "@builder.io/qwik";
import { cn } from "./design";
import { Link } from "@builder.io/qwik-city";

type Props = {
    class?: string;
}

export default component$(({ class: className }: Props) => {
    return (
        <footer class={cn("w-full max-w-[750px] px-4 mx-auto z-20 pb-16 text-sm text-gray-600/70 dark:text-gray-400/70", className)}>
            <hr class="border-none w-full h-[1.5px] bg-gray-300 dark:bg-gray-700" />
            <div class="py-4 px-3 flex justify-between">
                <div class="flex gap-4 items-center h-6 leading-none -ml-3">
                    <Link href="/" class="hover:text-gray-700 dark:hover:text-gray-300 -mt-1 transition-all duration-200">
                        <svg
                            width="24"
                            height="24"
                            viewBox="0 0 24 24"
                            version="1.1"
                            class="size-6"
                            xmlns="http://www.w3.org/2000/svg">
                            <g
                                id="layer1">
                                <path
                                    d="M 2.2673611,5.0942341 H 21.732639 V 6.1658185 H 2.2673611 Z m 0,6.3699749 H 21.732639 v 1.071583 H 2.2673611 Z m 0,6.369972 H 21.732639 v 1.071585 H 2.2673611 Z"
                                    style="font-size:12px;fill:none;fill-opacity:1;fill-rule:evenodd;stroke:currentColor;stroke-width:3.72245;stroke-linecap:round;stroke-dasharray:none;stroke-opacity:1" />
                            </g>
                        </svg>
                    </Link>
                    <Link href="/about" class="hover:text-gray-700 dark:hover:text-gray-300 transition-all duration-200">
                        About Us
                    </Link>
                    <Link href="/pricing" class="hover:text-gray-700 dark:hover:text-gray-300 transition-all duration-200">
                        Pricing
                    </Link>
                    <Link href="/docs" class="hover:text-gray-700 dark:hover:text-gray-300 transition-all duration-200">
                        Docs
                    </Link>
                </div>
                <div class="flex items-center [&_svg]:size-5 -mr-3 gap-4">
                    <Link href="mailto:hi@nestri.io" target="_blank" class="hover:text-gray-700 dark:hover:text-gray-300 transition-all duration-200">
                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" color="currentColor"><path d="m7 8.5l2.942 1.74c1.715 1.014 2.4 1.014 4.116 0L17 8.5" /><path d="M2.016 13.476c.065 3.065.098 4.598 1.229 5.733c1.131 1.136 2.705 1.175 5.854 1.254c1.94.05 3.862.05 5.802 0c3.149-.079 4.723-.118 5.854-1.254c1.131-1.135 1.164-2.668 1.23-5.733c.02-.986.02-1.966 0-2.952c-.066-3.065-.099-4.598-1.23-5.733c-1.131-1.136-2.705-1.175-5.854-1.254a115 115 0 0 0-5.802 0c-3.149.079-4.723.118-5.854 1.254c-1.131 1.135-1.164 2.668-1.23 5.733a69 69 0 0 0 0 2.952" /></g></svg>
                    </Link>
                    <Link href="https://github.com/nestrilabs/nestri" target="_blank" class="hover:text-gray-700 dark:hover:text-gray-300 transition-all duration-200 -mt-0.5">
                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><path fill="currentColor" d="M12 .999c-6.074 0-11 5.05-11 11.278c0 4.983 3.152 9.21 7.523 10.702c.55.104.727-.246.727-.543v-2.1c-3.06.683-3.697-1.33-3.697-1.33c-.5-1.304-1.222-1.65-1.222-1.65c-.998-.7.076-.686.076-.686c1.105.08 1.686 1.163 1.686 1.163c.98 1.724 2.573 1.226 3.201.937c.098-.728.383-1.226.698-1.508c-2.442-.286-5.01-1.253-5.01-5.574c0-1.232.429-2.237 1.132-3.027c-.114-.285-.49-1.432.107-2.985c0 0 .924-.303 3.026 1.156c.877-.25 1.818-.375 2.753-.38c.935.005 1.876.13 2.755.38c2.1-1.459 3.023-1.156 3.023-1.156c.598 1.554.222 2.701.108 2.985c.706.79 1.132 1.796 1.132 3.027c0 4.332-2.573 5.286-5.022 5.565c.394.35.754 1.036.754 2.088v3.095c0 .3.176.652.734.542C19.852 21.484 23 17.258 23 12.277C23 6.048 18.075.999 12 .999" /></svg>
                    </Link>
                    <Link href="https://discord.com/invite/Y6etn3qKZ3" target="_blank" class="hover:text-gray-700 dark:hover:text-gray-300 transition-all duration-200 -mt-0.5">
                        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><path fill="currentColor" d="M19.27 5.33C17.94 4.71 16.5 4.26 15 4a.1.1 0 0 0-.07.03c-.18.33-.39.76-.53 1.09a16.1 16.1 0 0 0-4.8 0c-.14-.34-.35-.76-.54-1.09c-.01-.02-.04-.03-.07-.03c-1.5.26-2.93.71-4.27 1.33c-.01 0-.02.01-.03.02c-2.72 4.07-3.47 8.03-3.1 11.95c0 .02.01.04.03.05c1.8 1.32 3.53 2.12 5.24 2.65c.03.01.06 0 .07-.02c.4-.55.76-1.13 1.07-1.74c.02-.04 0-.08-.04-.09c-.57-.22-1.11-.48-1.64-.78c-.04-.02-.04-.08-.01-.11c.11-.08.22-.17.33-.25c.02-.02.05-.02.07-.01c3.44 1.57 7.15 1.57 10.55 0c.02-.01.05-.01.07.01c.11.09.22.17.33.26c.04.03.04.09-.01.11c-.52.31-1.07.56-1.64.78c-.04.01-.05.06-.04.09c.32.61.68 1.19 1.07 1.74c.03.01.06.02.09.01c1.72-.53 3.45-1.33 5.25-2.65c.02-.01.03-.03.03-.05c.44-4.53-.73-8.46-3.1-11.95c-.01-.01-.02-.02-.04-.02M8.52 14.91c-1.03 0-1.89-.95-1.89-2.12s.84-2.12 1.89-2.12c1.06 0 1.9.96 1.89 2.12c0 1.17-.84 2.12-1.89 2.12m6.97 0c-1.03 0-1.89-.95-1.89-2.12s.84-2.12 1.89-2.12c1.06 0 1.9.96 1.89 2.12c0 1.17-.83 2.12-1.89 2.12" /></svg>
                    </Link>
                </div>
            </div>
        </footer>
    )
})