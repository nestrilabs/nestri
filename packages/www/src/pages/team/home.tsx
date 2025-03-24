import { FullScreen, theme } from "@nestri/www/ui";
import { styled } from "@macaron-css/solid";
import { Header } from "@nestri/www/pages/team/header";
import { useSteam } from "@nestri/www/providers/steam";
import { Modal } from "@nestri/www/ui/modal";
import { createEffect, createSignal, onCleanup } from "solid-js";
import { Text } from "@nestri/www/ui/text"
import { QRCode } from "@nestri/www/ui/custom-qr";
import { globalStyle, keyframes } from "@macaron-css/core";
import { A } from "@solidjs/router";

const Root = styled("div", {
    base: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        paddingTop: `calc(1px + ${theme.headerHeight.root})`,
        width: "100%",
        minHeight: `calc(100dvh - ${theme.headerHeight.root})`,
        gap: theme.space[3],
        justifyContent: "center"
    },
});

const EmptyState = styled("div", {
    base: {
        padding: "0 40px",
        display: "flex",
        gap: 10,
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        margin: "auto"
    }
})

const EmptyStateHeader = styled("h2", {
    base: {
        textAlign: "center",
        fontSize: theme.font.size["2xl"],
        fontFamily: theme.font.family.heading,
        fontWeight: theme.font.weight.semibold,
        letterSpacing: -0.5,
    }
})

const EmptyStateSubHeader = styled("p", {
    base: {
        fontWeight: theme.font.weight.regular,
        color: theme.color.gray.d900,
        fontSize: theme.font.size["lg"],
        textAlign: "center",
        maxWidth: 380,
        letterSpacing: -0.4,
        lineHeight: 1.1,
    }
})

const QRWrapper = styled("div", {
    base: {
        backgroundColor: theme.color.background.d100,
        position: "relative",
        marginBottom: 20,
        textWrap: "balance",
        border: `1px solid ${theme.color.gray.d400}`,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        overflow: "hidden",
        borderRadius: 22,
        padding: 20,
    }
})

const SteamMobileLink = styled(A, {
    base: {
        textUnderlineOffset: 2,
        textDecoration: "none",
        color: theme.color.blue.d900,
        display: "inline-flex",
        justifyContent: "center",
        alignItems: "center",
        gap: 1,
        width: "max-content",
        textTransform: "capitalize",
        ":hover": {
            textDecoration: "underline"
        }
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
                <Root>
                    <EmptyState
                        style={{
                            "--nestri-qr-dot-color": theme.color.d1000.gray,
                            "--nestri-body-background": theme.color.gray.d100
                        }}
                    >
                        <QRWrapper>
                            <QRCode
                                uri={"https://github.com/family/connectkit/blob/9a3c16c781d8a60853eff0c4988e22926a3f91ce"}
                                size={180}
                                ecl="M"
                            // clearArea={!!(imagePosition === 'center' && image)}
                            />
                        </QRWrapper>
                        <EmptyStateHeader>Sign in to your Steam account</EmptyStateHeader>
                        <EmptyStateSubHeader>Use your Steam Mobile App to sign in via QR code.&nbsp;<SteamMobileLink href="https://store.steampowered.com/mobile" target="_blank">Learn More<svg data-testid="geist-icon" height="16" stroke-linejoin="round" viewBox="0 0 16 16" width="16" style="color: currentcolor;"><path fill-rule="evenodd" clip-rule="evenodd" d="M11.5 9.75V11.25C11.5 11.3881 11.3881 11.5 11.25 11.5H4.75C4.61193 11.5 4.5 11.3881 4.5 11.25L4.5 4.75C4.5 4.61193 4.61193 4.5 4.75 4.5H6.25H7V3H6.25H4.75C3.7835 3 3 3.7835 3 4.75V11.25C3 12.2165 3.7835 13 4.75 13H11.25C12.2165 13 13 12.2165 13 11.25V9.75V9H11.5V9.75ZM8.5 3H9.25H12.2495C12.6637 3 12.9995 3.33579 12.9995 3.75V6.75V7.5H11.4995V6.75V5.56066L8.53033 8.52978L8 9.06011L6.93934 7.99945L7.46967 7.46912L10.4388 4.5H9.25H8.5V3Z" fill="currentColor"></path></svg></SteamMobileLink></EmptyStateSubHeader>
                    </EmptyState>
                </Root>
            </Header>
        </>
    )
}