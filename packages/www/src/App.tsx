import '@fontsource-variable/mona-sans';
import '@fontsource-variable/geist-mono';
import '@fontsource/geist-sans/400.css';
import '@fontsource/geist-sans/500.css';
import '@fontsource/geist-sans/600.css';
import '@fontsource/geist-sans/700.css';
import '@fontsource/geist-sans/800.css';
import '@fontsource/geist-sans/900.css';
import { TeamCreate } from './pages/new';
import { styled } from "@macaron-css/solid";
import { useStorage } from './providers/account';
import { darkClass, lightClass, theme } from './ui/theme';
import { AuthProvider, useAuth } from './providers/auth';
import { Navigate, Route, Router } from "@solidjs/router";
import { globalStyle, macaron$ } from "@macaron-css/core";
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
            backgroundColor: "hsla(0,0%,98%)",
        },
        "(prefers-color-scheme: dark)": {
            backgroundColor: "hsla(0,0%,0%)",
        },
    },
});

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
        <Root class={theme() === "light" ? lightClass : darkClass} id="styled">
            <Router>
                <Route
                    path="*"
                    component={(props) => (
                        <AuthProvider>
                            {props.children}
                        </AuthProvider>
                        // <CommandBar>
                        //         <ReplicacheStatusProvider>
                        //             <DummyProvider>
                        //                 <DummyConfigProvider>
                        //                     <FlagsProvider>
                        //                         <RealtimeProvider />
                        //                         <LocalProvider>
                        //                             <LocalLogsProvider>
                        //                                 <GlobalCommands />
                        //                                 {props.children}
                        //                             </LocalLogsProvider>
                        //                         </LocalProvider>
                        //                     </FlagsProvider>
                        //                 </DummyConfigProvider>
                        //             </DummyProvider>
                        //         </ReplicacheStatusProvider>
                        //     </AuthProvider>
                        // </CommandBar>
                    )}
                >
                    {/* <Route path="local" component={Local} />
                        <Route path="debug" component={DebugRoute} />
                        <Route path="design" component={Design} />
                        <Route path="workspace" component={WorkspaceCreate} />
                        <Route path=":workspaceSlug">{WorkspaceRoute}</Route> */}
                    <Route path="new" component={TeamCreate} />
                    <Route
                        path="/"
                        component={() => {
                            const auth = useAuth();
                            return (
                                <Switch>
                                    <Match when={auth.current.teams.length > 0}>
                                        <Navigate
                                            href={`/${(
                                                auth.current.teams.find(
                                                    (w) => w.id === storage.value.team,
                                                ) || auth.current.teams[0]
                                            ).slug
                                                }`}
                                        />
                                    </Match>
                                    <Match when={true}>
                                        <Navigate href={`/new`} />
                                    </Match>
                                </Switch>
                            );
                        }}
                    />
                    {/* <Route path="*" component={() => <NotFound />} /> */}
                </Route>
            </Router>
        </Root>
    )
}