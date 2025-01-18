import { $, component$, useOnDocument, useSignal } from "@builder.io/qwik";
import { Link, useLocation } from "@builder.io/qwik-city";
import { buttonVariants, cn } from "./design";

const navLinks = [
    {
        name: "About Us",
        href: "/about"
    },
    {
        name: "Pricing",
        href: "/pricing"
    },
    {
        name: "Login",
    }
]

type Props = {
    link?: string
}


export const NavBar = component$(({ link }: Props) => {
    const location = useLocation()

    const hasScrolled = useSignal(false);

    useOnDocument(
        'scroll',
        $(() => {
            hasScrolled.value = window.scrollY > 0;
        })
    );

    return (
        <nav class={cn("w-full sticky top-0 z-50 text-sm font-extrabold bg-gray-100/70 dark:bg-gray-900/70 before:backdrop-blur-[15px] before:absolute before:-z-[1] before:top-0 before:left-0 before:w-full before:h-full", hasScrolled.value && "shadow-[0_2px_20px_1px] shadow-gray-300 dark:shadow-gray-700")} >
            <button onClick$={() => window.location.href = link as string} class="w-full text-gray-900/70 bg-gray-400/30 dark:bg-gray-600/30 dark:text-gray-100/30 whitespace-nowrap font-mono text-sm py-3">
                <div class="flex relative">
                    <span class="whitespace-pre marquee-animation">
                        Launching Soon · Login to reserve your username · Launching Soon · Login to reserve your username · Launching Soon · Login to reserve your username ·
                        Launching Soon · Login to reserve your username · Launching Soon · Login to reserve your username · Launching Soon · Login to reserve your username ·
                    </span>
                </div>
            </button>
            <div class="px-4 mx-auto flex max-w-xl items-center border-b-2 dark:border-gray-50/50 border-gray-950/50" >
                <Link class="outline-none focus:ring-2 py-1 px-3 -ml-3 rounded-lg focus:ring-primary-500 duration-200 transition-all" href="/" >
                    <h1 class="text-lg font-title" >
                        Nestri
                    </h1>
                </Link>
                <ul class="ml-0 -mr-4 flex font-medium m-4 flex-1 gap-1 tracking-[0.035em] items-center justify-end dark:text-primary-50/70 text-primary-950/70">
                    {navLinks.map((linkItem, key) => (
                        <li key={`linkItem-${key}`}>
                            <Link href={linkItem.href ? linkItem.href : link} class={cn(buttonVariants.ghost({ intent: "gray", size: "sm" }), "hover:bg-gray-300/70 dark:hover:bg-gray-700/70 focus:ring-2 outline-none focus:ring-primary-500 duration-200 transition-all", location.url.pathname === linkItem.href && "bg-gray-300/70 hover:bg-gray-300/70 dark:bg-gray-700/70 dark:hover:bg-gray-700/70")}>
                                {linkItem.name}
                            </Link>
                        </li>
                    ))}
                </ul>
            </div>
        </nav>
    )
})