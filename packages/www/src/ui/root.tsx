import { createSignal, JSX, onCleanup } from "solid-js";
import { useStorage } from "@nestri/www/providers/account";
import { darkClass, lightClass, theme } from "./theme";
import { styled } from "@macaron-css/solid";

const BaseComponent = styled("div", {
    base: {
        inset: 0,
        lineHeight: 1,
        fontSynthesis: "none",
        color: theme.color.d1000.gray,
        fontFamily: theme.font.family.body,
        textRendering: "optimizeLegibility",
        WebkitFontSmoothing: "antialised",
        backgroundColor: theme.color.background.d100,
    },
});

export default function Root(props: { children: number | boolean | Node | JSX.ArrayElement | (string & {}) | null | undefined; }) {
    const [theme, setTheme] = createSignal<string>(
        window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light",
    );

    const darkMode = window.matchMedia("(prefers-color-scheme: dark)");
    const setColorScheme = (e: MediaQueryListEvent) => {
        setTheme(e.matches ? "dark" : "light");
    };
    darkMode.addEventListener("change", setColorScheme);
    onCleanup(() => {
        darkMode.removeEventListener("change", setColorScheme);
    });

    return (
        <BaseComponent class={theme() === "light" ? lightClass : darkClass} id="styled">
            {props.children}
        </BaseComponent>
    )
}