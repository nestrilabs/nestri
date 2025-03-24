import { FullScreen, theme } from "@nestri/www/ui";
import { styled } from "@macaron-css/solid";
import { Header } from "@nestri/www/pages/team/header";
import { useSteam } from "@nestri/www/providers/steam";
import { Modal } from "@nestri/www/ui/modal";
import { createEffect, createSignal, onCleanup } from "solid-js";
import { Text } from "@nestri/www/ui/text"
import { QRCode } from "@nestri/www/ui/custom-qr";
import { globalStyle, keyframes } from "@macaron-css/core";

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
        fontWeight: theme.font.weight.medium,
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
        letterSpacing: -0.4
    }
})

const bgRotate = keyframes({
    'to': { transform: 'rotate(1turn)' },
});

// const QRContainer = styled("div", {
//     base: {
//         position: "relative",
//         display: "flex",
//         justifyContent: "center",
//         alignItems: "center",
//         overflow: "hidden",
//         borderRadius: 25,
//         padding: 5,
//         isolation: "isolate",
//         ":before": {
//             content: "",
//             backgroundImage: "conic-gradient(from 0deg,transparent 0,#4DAFFE 10%,#4DAFFE 25%,transparent 35%)",
//             animation: `${bgRotate} 1.25s linear infinite`,
//             width: "200%",
//             height: "200%",
//             zIndex: 0,
//             top: "-50%",
//             left: "-50%",
//             position: "absolute"
//         },
//         ":after": {
//             content: "",
//             zIndex: 1,
//             inset: 5,
//             backgroundColor: theme.color.background.d100,
//             borderRadius: 22,
//             position: "absolute"
//         }
//     },
// })

// const QRWrapper = styled("div", {
//     base: {
//         backgroundColor: theme.color.background.d100,
//         border: `1px solid ${theme.color.gray.d400}`,
//         position: "relative",
//         display: "flex",
//         justifyContent: "center",
//         alignItems: "center",
//         overflow: "hidden",
//         borderRadius: 22,
//         zIndex:3,
//         padding: 20,
//     }
// })

const QRContainer = styled("div", {
    base: {
        position: "relative",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        overflow: "hidden",
        borderRadius: 25,
        padding: 5,
        isolation: "isolate", // Create stacking context
        ":before": {
            content: '""',
            backgroundImage: `conic-gradient(from 0deg,transparent 0,${theme.color.blue.d500} 10%,${theme.color.blue.d500} 25%,transparent 35%)`,
            animation: `${bgRotate} 1.25s linear infinite`,
            width: "200%",
            height: "200%",
            zIndex: -2,
            top: "-50%",
            left: "-50%",
            position: "absolute"
        },
        ":after": {
            content: '""',
            zIndex: -1,
            inset: 5,
            backgroundColor: theme.color.background.d100,
            borderRadius: 22,
            position: "absolute"
        }
    },
})

const QRWrapper = styled("div", {
    base: {
        backgroundColor: theme.color.background.d100, // Add a solid white background
        position: "relative",
        border: `1px solid ${theme.color.gray.d400}`,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        overflow: "hidden",
        borderRadius: 22,
        zIndex: 1, // Ensure it's above the animation
        padding: 20,
    }
})

// Add an additional wrapper for the QR code
const QRInnerWrapper = styled("div", {
    base: {
        backgroundColor: theme.color.background.d100, // Ensure background for QR code
        borderRadius: 18,
        padding: 10,
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
                        <QRContainer>
                            <QRWrapper>
                                <QRInnerWrapper>
                                    <QRCode
                                        uri={"https://github.com/family/connectkit/blob/9a3c16c781d8a60853eff0c4988e22926a3f91ce"}
                                        size={180}
                                        ecl="M"
                                    // clearArea={!!(imagePosition === 'center' && image)}
                                    />
                                </QRInnerWrapper>
                            </QRWrapper>
                        </QRContainer>
                        <EmptyStateHeader>Dot for Web is for subscribers only</EmptyStateHeader>
                        <EmptyStateSubHeader>Scan the code to subscribe in the iOS app.</EmptyStateSubHeader>
                    </EmptyState>
                </Root>
            </Header>
        </>
    )
}