import { theme } from "@nestri/www/ui";
import { styled } from "@macaron-css/solid";
import { Header } from "@nestri/www/pages/team/header";
import { useSteam } from "@nestri/www/providers/steam";
import { createEffect, createSignal, onCleanup } from "solid-js";

const Root = styled("div", {
    base: {
        padding: theme.space[4],
        backgroundColor: theme.color.background.d200,
    },
});

export function HomeRoute() {

    // const steam = useSteam();
    // const [loginUrl, setLoginUrl] = createSignal<string | null>(null);
    // const [loginStatus, setLoginStatus] = createSignal<string | null>("Not connected");
    // const [userData, setUserData] = createSignal<{ username?: string, steamId?: string } | null>(null);

    // createEffect(async () => {
    //     // Connect to the Steam login stream
    //     const steamConnection = await steam.client.login.connect();

    //     // Set up event listeners for different event types
    //     const urlUnsubscribe = steamConnection.addEventListener('url', (url) => {
    //         setLoginUrl(url);
    //         setLoginStatus('Scan QR code with Steam mobile app');
    //     });

    //     const loginAttemptUnsubscribe = steamConnection.addEventListener('login-attempt', (data) => {
    //         setLoginStatus(`Logging in as ${data.username}...`);
    //     });

    //     const loginSuccessUnsubscribe = steamConnection.addEventListener('login-success', (data) => {
    //         setUserData(data);
    //         setLoginStatus(`Successfully logged in as ${data.username}`);
    //     });

    //     const loginUnsuccessfulUnsubscribe = steamConnection.addEventListener('login-unsuccessful', (data) => {
    //         setLoginStatus(`Login failed: ${data.error}`);
    //     });

    //     const loggedOffUnsubscribe = steamConnection.addEventListener('logged-off', (data) => {
    //         setLoginStatus(`Logged out of Steam: ${data.reason}`);
    //         setUserData(null);
    //     });

    //     onCleanup(() => {
    //         urlUnsubscribe();
    //         loginAttemptUnsubscribe();
    //         loginSuccessUnsubscribe();
    //         loginUnsuccessfulUnsubscribe();
    //         loggedOffUnsubscribe();
    //         steamConnection.disconnect();
    //     });
    // })

    return (
        <>
            <Header />
            <Root>
               
            </Root>
        </>
    )
}