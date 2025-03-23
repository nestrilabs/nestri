import { FullScreen, theme } from "@nestri/www/ui";
import { styled } from "@macaron-css/solid";
import { Header } from "@nestri/www/pages/team/header";
import { useSteam } from "@nestri/www/providers/steam";
import { Modal } from "@nestri/www/ui/modal";
import { createEffect, createSignal, onCleanup } from "solid-js";
import { Text } from "@nestri/www/ui/text"

const Root = styled("div", {
    base: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        paddingTop:"calc(1px + 3.25rem)",
        width:"100%",
        height:"100%",
        gap: theme.space[3],
        // maxWidth: 380
    },
});

const Heading = styled("h1", {
    base: {
        fontFamily: theme.font.family.heading,
        fontSize: theme.font.size["2xl"]
    }
})

const SubHeading = styled("span", {
    base: {
        fontSize: theme.font.size.base,
        color: theme.color.gray.d900,
        lineHeight: 1.2
    }
})

const QRButton = styled("button", {
    base: {
        height: 40,
        borderRadius: theme.borderRadius,
        backgroundColor: theme.color.d1000.gray,
        color: theme.color.gray.d100,
        fontSize: theme.font.size.sm,
        textWrap: "nowrap",
        border: "1px solid transparent",
        padding: `${theme.space[2]} ${theme.space[4]}`,
        letterSpacing: 0.1,
        lineHeight: "1.25rem",
        fontFamily: theme.font.family.body,
        fontWeight: theme.font.weight.medium,
        cursor: "pointer",
        transitionDelay: "0s, 0s",
        transitionDuration: "0.2s, 0.2s",
        transitionProperty: "background-color, border",
        transitionTimingFunction: "ease-out, ease-out",
        display: "inline-flex",
        gap: theme.space[2],
        alignItems: "center",
        justifyContent: "center",
        ":disabled": {
            pointerEvents: "none",
        },
        ":hover": {
            background: theme.color.hoverColor
        }
    }
})

const ButtonText = styled("span", {
    base: {
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        overflow: "hidden",
    }
})

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
            <Header>
                {/* <FullScreen inset="header"> */}
                <Root>
                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
                        <path fill="currentColor" d="M15.974 0C7.573 0 .682 6.479.031 14.714l8.573 3.547a4.5 4.5 0 0 1 2.552-.786c.083 0 .167.005.25.005l3.813-5.521v-.078c0-3.328 2.703-6.031 6.031-6.031s6.036 2.708 6.036 6.036a6.04 6.04 0 0 1-6.036 6.031h-.135l-5.438 3.88c0 .073.005.141.005.214c0 2.5-2.021 4.526-4.521 4.526c-2.177 0-4.021-1.563-4.443-3.635L.583 20.36c1.901 6.719 8.063 11.641 15.391 11.641c8.833 0 15.995-7.161 15.995-16s-7.161-16-15.995-16zm-5.922 24.281l-1.964-.813a3.4 3.4 0 0 0 1.755 1.667a3.404 3.404 0 0 0 4.443-1.833a3.38 3.38 0 0 0 .005-2.599a3.36 3.36 0 0 0-1.839-1.844a3.38 3.38 0 0 0-2.5-.042l2.026.839c1.276.536 1.88 2 1.349 3.276s-2 1.88-3.276 1.349zm15.219-12.406a4.025 4.025 0 0 0-4.016-4.021a4.02 4.02 0 1 0 0 8.042a4.02 4.02 0 0 0 4.016-4.021m-7.026-.005c0-1.672 1.349-3.021 3.016-3.021s3.026 1.349 3.026 3.021c0 1.667-1.359 3.021-3.026 3.021s-3.016-1.354-3.016-3.021" />
                    </svg>
                    <Heading>
                        Steam Library
                    </Heading>
                    <SubHeading>
                        Link your account to install games directly from your Steam account to your Nestri Machine
                    </SubHeading>
                    <Modal.Root>
                        <Modal.Trigger>
                            <QRButton>
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 32 32">
                                    <path fill="currentColor" d="M15.974 0C7.573 0 .682 6.479.031 14.714l8.573 3.547a4.5 4.5 0 0 1 2.552-.786c.083 0 .167.005.25.005l3.813-5.521v-.078c0-3.328 2.703-6.031 6.031-6.031s6.036 2.708 6.036 6.036a6.04 6.04 0 0 1-6.036 6.031h-.135l-5.438 3.88c0 .073.005.141.005.214c0 2.5-2.021 4.526-4.521 4.526c-2.177 0-4.021-1.563-4.443-3.635L.583 20.36c1.901 6.719 8.063 11.641 15.391 11.641c8.833 0 15.995-7.161 15.995-16s-7.161-16-15.995-16zm-5.922 24.281l-1.964-.813a3.4 3.4 0 0 0 1.755 1.667a3.404 3.404 0 0 0 4.443-1.833a3.38 3.38 0 0 0 .005-2.599a3.36 3.36 0 0 0-1.839-1.844a3.38 3.38 0 0 0-2.5-.042l2.026.839c1.276.536 1.88 2 1.349 3.276s-2 1.88-3.276 1.349zm15.219-12.406a4.025 4.025 0 0 0-4.016-4.021a4.02 4.02 0 1 0 0 8.042a4.02 4.02 0 0 0 4.016-4.021m-7.026-.005c0-1.672 1.349-3.021 3.016-3.021s3.026 1.349 3.026 3.021c0 1.667-1.359 3.021-3.026 3.021s-3.016-1.354-3.016-3.021" />
                                </svg>
                                <ButtonText>
                                    Connect Steam
                                </ButtonText>
                            </QRButton>
                        </Modal.Trigger>
                        <Modal.Panel>
                            Blah blah blah
                        </Modal.Panel>
                    </Modal.Root>
                </Root>
                {/* </FullScreen> */}
            </Header>
        </>
    )
}