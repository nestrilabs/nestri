import '@fontsource-variable/mona-sans';
import '@fontsource-variable/geist-mono';
import '@fontsource/geist-sans/400.css';
import '@fontsource/geist-sans/500.css';
import '@fontsource/geist-sans/600.css';
import '@fontsource/geist-sans/700.css';
import '@fontsource/geist-sans/800.css';
import '@fontsource/geist-sans/900.css';
import { darkClass, lightClass, theme } from './ui/theme';
import { styled } from "@macaron-css/solid";
import { Component, createSignal, onCleanup } from 'solid-js';

const Root = styled("div", {
    base: {
        inset: 0,
        lineHeight: 1,
        fontFamily: theme.font.family.body,
        fontSynthesis: "none",
        textRendering: "geometricPrecision",
        backgroundColor: theme.color.background.d200,
    },
});

export const App: Component = () => {
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
        <Root class={theme() === "light" ? lightClass : darkClass} id="styled">
            Hello there
        </Root>
    )
}