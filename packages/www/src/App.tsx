import '@fontsource-variable/mona-sans';
import '@fontsource-variable/geist-mono';
import '@fontsource/geist-sans/400.css';
import '@fontsource/geist-sans/500.css';
import '@fontsource/geist-sans/600.css';
import '@fontsource/geist-sans/700.css';
import '@fontsource/geist-sans/800.css';
import '@fontsource/geist-sans/900.css';
import { Text } from '@nestri/www/ui/text';
import { styled } from "@macaron-css/solid";
import { ZeroProvider } from './providers/zero';
import { ProfilesRoute } from './pages/profiles';
import { NewProfile } from '@nestri/www/pages/new';
import { SteamRoute } from '@nestri/www/pages/steam';
import { OpenAuthProvider } from "@openauthjs/solid";
import { NotFound } from '@nestri/www/pages/not-found';
import { Navigate, Route, Router } from "@solidjs/router";
import { globalStyle, macaron$ } from "@macaron-css/core";
import { useStorage } from '@nestri/www/providers/account';
import { Screen as FullScreen } from '@nestri/www/ui/layout';
import { darkClass, lightClass, theme } from '@nestri/www/ui/theme';
import { AccountProvider, useAccount } from '@nestri/www/providers/account';
import { Component, createSignal, Match, onCleanup, Switch } from 'solid-js';

const Root = styled("div", {
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

globalStyle("html", {
    fontSize: 16,
    fontWeight: 400,
    // Hardcode colors
    "@media": {
        "(prefers-color-scheme: light)": {
            backgroundColor: "#f4f5f6",
        },
        "(prefers-color-scheme: dark)": {
            backgroundColor: "rgb(19,21,23)",
        },
    },
});

globalStyle("dialog:modal", {
    maxHeight: "unset",
    maxWidth: "unset"
})

globalStyle("h1, h2, h3, h4, h5, h6, p", {
    margin: 0,
});

macaron$(() =>
    ["::placeholder", ":-ms-input-placeholder"].forEach((selector) =>
        globalStyle(selector, {
            opacity: 1,
            color: theme.color.d1000.gray,
        }),
    ),
);

globalStyle("body", {
    cursor: "default",
});

globalStyle("*", {
    boxSizing: "border-box",
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

    const storage = useStorage();

    return (
        <OpenAuthProvider
            issuer={import.meta.env.VITE_AUTH_URL}
            clientID="web"
        >
            <Root class={theme() === "light" ? lightClass : darkClass}>
                <Router>
                    <Route
                        path="*"
                        component={(props) => (
                            <AccountProvider
                                loadingUI={
                                    <FullScreen>
                                        <Text weight='semibold' spacing='xs' size="3xl" font="heading" >Confirming your identity&hellip;</Text>
                                    </FullScreen>
                                }>
                                <ZeroProvider>
                                    {/* props.children */}
                                    {props.children}
                                </ZeroProvider>
                            </AccountProvider>
                        )}
                    >
                        <Route path=":steamID">{SteamRoute}</Route>
                        <Route path="profiles" component={ProfilesRoute} />
                        <Route path="new" component={NewProfile} />
                        <Route
                            path="/"
                            component={() => {
                                const account = useAccount();
                                return (
                                    <Switch>
                                        <Match when={account.current.profiles.length > 0}>
                                            <Navigate
                                                href={`/${(
                                                    account.current.profiles.find(
                                                        (w) => w.id === storage.value.steam,
                                                    ) || account.current.profiles[0]
                                                ).id}`}
                                            />
                                        </Match>
                                        <Match when={true}>
                                            <Navigate href={`/new`} />
                                        </Match>
                                    </Switch>
                                );
                            }}
                        />
                        <Route path="*" component={() => <NotFound />} />
                    </Route>
                </Router>
            </Root>
        </OpenAuthProvider>
    )
}