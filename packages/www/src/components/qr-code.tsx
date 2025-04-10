import { theme } from "@nestri/www/ui";
import { A } from "@solidjs/router";
import { styled } from "@macaron-css/solid";
import { useSteam } from "../providers/steam";
import { keyframes } from "@macaron-css/core";
import { QRCode } from "@nestri/www/ui/custom-qr";
import { createEffect, createSignal, onCleanup, Show } from "solid-js";

const EmptyState = styled("div", {
    base: {
        padding: "0 40px",
        display: "flex",
        height: "100dvh",
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
        fontSize: theme.font.size["base"],
        textAlign: "center",
        maxWidth: 380,
        letterSpacing: -0.4,
        lineHeight: 1.1,
    }
})

const bgRotate = keyframes({
    'to': { transform: 'rotate(1turn)' },
});

const QRContainer = styled("div", {
    base: {
        position: "relative",
        display: "flex",
        overflow: "hidden",
        marginBottom: 20,
        justifyContent: "center",
        alignItems: "center",
        borderRadius: 25,
        padding: 5,
        isolation: "isolate",
        ":after": {
            content: "",
            zIndex: -1,
            inset: 5,
            backgroundColor: theme.color.background.d100,
            borderRadius: 22,
            position: "absolute"
        }
    },
    variants: {
        login: {
            true: {
                ":before": {
                    content: "",
                    backgroundImage: `conic-gradient(from 0deg,transparent 0,${theme.color.blue.d600} 10%,${theme.color.blue.d600} 25%,transparent 35%)`,
                    animation: `${bgRotate} 2.25s linear infinite`,
                    width: "200%",
                    height: "200%",
                    zIndex: -2,
                    top: "-50%",
                    left: "-50%",
                    position: "absolute"
                },
            }
        }
    }
})

const QRWrapper = styled("div", {
    base: {
        backgroundColor: theme.color.background.d100,
        position: "relative",
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

const QRBg = styled("div", {
    base: {
        backgroundColor: theme.color.background.d200,
        position: "absolute",
        inset: 0,
        margin: 5,
        borderRadius: 20
    }
})

const QRReloadBtn = styled("button", {
    base: {
        background: "none",
        border: "none",
        width: 50,
        height: 50,
        position: "absolute",
        borderRadius: 25,
        zIndex: 5,
        right: 2,
        bottom: 2,
        cursor: "pointer",
        color: theme.color.blue.d700,
        transition: "color 200ms",
        overflow: "hidden",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        ":before": {
            zIndex: 3,
            content: "",
            position: "absolute",
            inset: 0,
            opacity: 0,
            transition: "opacity 200ms",
            background: "#FFF"
        }
    }
})

const QRRealoadContainer = styled("div", {
    base: {
        position: "absolute",
        inset: 0,
        isolation: "isolate",
        ":before": {
            background: `conic-gradient( from 90deg, currentColor 10%, #FFF 80% )`,
            inset: 3,
            borderRadius: 16,
            position: "absolute",
            content: "",
            zIndex: 1
        }
    }
})

const QRReloadSvg = styled("svg", {
    base: {
        zIndex: 2,
        width: "100%",
        height: "100%",
        position: "relative",
        display: "block"
    }
})

const LogoContainer = styled("div", {
    base: {
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
    }
})

const LogoIcon = styled("svg", {
    base: {
        zIndex: 6,
        position: "absolute",
        left: "50%",
        top: "50%",
        transform: "translate(-50%,-50%)",
        overflow: "hidden",
        // width: "21%",
        // height: "21%",
        borderRadius: 17,
        // ":before": {
        //     pointerEvents: "none",
        //     zIndex: 2,
        //     content: '',
        //     position: "absolute",
        //     inset: 0,
        //     borderRadius: "inherit",
        //     boxShadow: "inset 0 0 0 1px rgba(0, 0, 0, 0.02)",
        // }
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

/**
 * Manages the Steam authentication flow via a reactive hook.
 *
 * This hook connects to Steam's login stream for QR code authentication, updating the internal state through reactive signals. It sets up event listeners to capture authentication challenges (setting the login URL) and errors (flagging login errors), and it provides methods to initiate and re-establish the connection.
 *
 * The returned object includes:
 * - loginError: A signal that indicates whether an authentication error has occurred.
 * - loginUrl: A signal that holds the URL received on a successful authentication challenge.
 * - isConnecting: A signal that reflects whether the authentication process is currently in progress.
 * - authenticateSteam: A function that initiates the authentication process, sets up event listeners, and returns cleanup and reset functions.
 * - reconnect: A function that cleans up any existing connection and initiates a new authentication attempt.
 *
 * @returns An object with authentication state signals and functions to manage the connection.
 */
export function useSteamAuth() {
    const [loginError, setLoginError] = createSignal<boolean>(false);
    const [loginUrl, setLoginUrl] = createSignal<string | undefined>();
    const [isConnecting, setIsConnecting] = createSignal<boolean>(false);
    const [disconnectFn, setDisconnectFn] = createSignal<(() => void) | null>(null);
    const steam = useSteam()
    // Function to authenticate with Steam
    const authenticateSteam = async () => {
        try {
            setIsConnecting(true);
            setLoginError(false);

            // Connect to the Steam login stream
            const steamConnection = await steam.client.login.connect();

            // Set up event listeners for different event types
            const urlUnsubscribe = steamConnection.addEventListener('challenge', (data) => {
                setLoginUrl(data.url);
            });

            const loginUnsuccessfulUnsubscribe = steamConnection.addEventListener('error', (data) => {
                setLoginError(true);
            });

            // Store the disconnect function for later use
            const cleanupConnection = () => {
                urlUnsubscribe();
                loginUnsuccessfulUnsubscribe();
                steamConnection.disconnect();
            };

            setDisconnectFn(() => cleanupConnection);
            setIsConnecting(false);

            return {
                cleanup: cleanupConnection,
                resetConnection: () => {
                    cleanupConnection();
                    authenticateSteam();
                }
            };
        } catch (error) {
            setLoginError(true);
            setIsConnecting(false);
            console.error("Steam authentication error:", error);
            return {
                cleanup: () => { },
                resetConnection: () => authenticateSteam()
            };
        }
    };

    // Function to reconnect
    const reconnect = async () => {
        // Clean up existing connection if any
        const currentDisconnectFn = disconnectFn();
        if (currentDisconnectFn) {
            currentDisconnectFn();
        }

        // Start a new connection
        return authenticateSteam();
    };

    return {
        loginError,
        loginUrl,
        isConnecting,
        authenticateSteam,
        reconnect
    };
}

/**
 * Renders a Steam QR code authentication interface.
 *
 * On mount, the component initiates the Steam authentication process using a custom hook and sets up a cleanup routine upon unmounting. It conditionally displays a QR code for signing in when a valid login URL is available, a reload button if an error occurs, or a timeout message if the request times out.
 *
 * @example
 * <QrCodeComponent />
 *
 * @returns A Solid.js component that provides a QR code authentication UI for Steam.
 */
export function QrCodeComponent() {
    const { loginError, loginUrl, isConnecting, authenticateSteam, reconnect } = useSteamAuth();

    createEffect(async () => {
        const { cleanup } = await authenticateSteam();
        onCleanup(() => cleanup());
    });


    return (
        <EmptyState
            style={{
                "--nestri-qr-dot-color": theme.color.d1000.gray,
                "--nestri-body-background": theme.color.gray.d100
            }}
        >
            <QRContainer login={typeof loginUrl() === "string" && !loginError()}>
                <QRBg />
                <QRWrapper>
                    <LogoContainer>
                        <LogoIcon
                            xmlns="http://www.w3.org/2000/svg" width={!loginError() && loginUrl() ? 32 : 60} height={!loginError() && loginUrl() ? 32 : 60} viewBox="0 0 16 16">
                            <g fill="currentColor">
                                <path d="M.329 10.333A8.01 8.01 0 0 0 7.99 16C12.414 16 16 12.418 16 8s-3.586-8-8.009-8A8.006 8.006 0 0 0 0 7.468l.003.006l4.304 1.769A2.2 2.2 0 0 1 5.62 8.88l1.96-2.844l-.001-.04a3.046 3.046 0 0 1 3.042-3.043a3.046 3.046 0 0 1 3.042 3.043a3.047 3.047 0 0 1-3.111 3.044l-2.804 2a2.223 2.223 0 0 1-3.075 2.11a2.22 2.22 0 0 1-1.312-1.568L.33 10.333Z" /><path d="M4.868 12.683a1.715 1.715 0 0 0 1.318-3.165a1.7 1.7 0 0 0-1.263-.02l1.023.424a1.261 1.261 0 1 1-.97 2.33l-.99-.41a1.7 1.7 0 0 0 .882.84Zm3.726-6.687a2.03 2.03 0 0 0 2.027 2.029a2.03 2.03 0 0 0 2.027-2.029a2.03 2.03 0 0 0-2.027-2.027a2.03 2.03 0 0 0-2.027 2.027m2.03-1.527a1.524 1.524 0 1 1-.002 3.048a1.524 1.524 0 0 1 .002-3.048" />
                            </g>
                        </LogoIcon>
                    </LogoContainer>
                    <Show
                        when={!loginError() && loginUrl()}
                        fallback={
                            <div style={{ height: "220px", width: "220px" }} />
                        }
                    >
                        <QRCode
                            uri={loginUrl()!}
                            size={240}
                            ecl="M"
                            clearArea={true}
                        />
                    </Show>
                </QRWrapper>
                <Show when={loginError()}>
                    <QRReloadBtn onClick={() => reconnect()} disabled={isConnecting()}>
                        <QRRealoadContainer>
                            <QRReloadSvg aria-hidden="true" width="32" height="32" viewBox="0 0 32 32" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M32 16C32 24.8366 24.8366 32 16 32C7.16344 32 0 24.8366 0 16C0 7.16344 7.16344 0 16 0C24.8366 0 32 7.16344 32 16ZM24.5001 8.74263C25.0834 8.74263 25.5563 9.21551 25.5563 9.79883V14.5997C25.5563 15.183 25.0834 15.6559 24.5001 15.6559H19.6992C19.1159 15.6559 18.643 15.183 18.643 14.5997C18.643 14.0164 19.1159 13.5435 19.6992 13.5435H21.8378L20.071 11.8798C20.0632 11.8724 20.0555 11.865 20.048 11.8574C19.1061 10.915 17.8835 10.3042 16.5643 10.1171C15.2452 9.92999 13.9009 10.1767 12.7341 10.82C11.5674 11.4634 10.6413 12.4685 10.0955 13.684C9.54968 14.8994 9.41368 16.2593 9.70801 17.5588C10.0023 18.8583 10.711 20.0269 11.7273 20.8885C12.7436 21.7502 14.0124 22.2582 15.3425 22.336C16.6726 22.4138 17.9919 22.0572 19.1017 21.3199C19.5088 21.0495 19.8795 20.7333 20.2078 20.3793C20.6043 19.9515 21.2726 19.9262 21.7004 20.3228C22.1282 20.7194 22.1534 21.3876 21.7569 21.8154C21.3158 22.2912 20.8176 22.7161 20.2706 23.0795C18.7793 24.0702 17.0064 24.5493 15.2191 24.4448C13.4318 24.3402 11.7268 23.6576 10.3612 22.4998C8.9956 21.3419 8.0433 19.7716 7.6478 18.0254C7.2523 16.2793 7.43504 14.4519 8.16848 12.8186C8.90192 11.1854 10.1463 9.83471 11.7142 8.97021C13.282 8.10572 15.0884 7.77421 16.861 8.02565C18.6282 8.27631 20.2664 9.09278 21.5304 10.3525L23.4439 12.1544V9.79883C23.4439 9.21551 23.9168 8.74263 24.5001 8.74263Z" fill="currentColor"></path></QRReloadSvg>
                        </QRRealoadContainer>
                    </QRReloadBtn>
                </Show>
            </QRContainer>
            <Show
                fallback={
                    <>
                        <EmptyStateHeader>Request Timed Out</EmptyStateHeader>
                        <EmptyStateSubHeader>Click above to try again.</EmptyStateSubHeader>
                    </>
                }
                when={!loginError() && loginUrl()} >
                <EmptyStateHeader>Sign in to your Steam account</EmptyStateHeader>
                <EmptyStateSubHeader>Use your Steam Mobile App to sign in via QR code.&nbsp;<SteamMobileLink href="https://store.steampowered.com/mobile" target="_blank">Learn More<svg data-testid="geist-icon" height="20" stroke-linejoin="round" viewBox="0 0 16 16" width="20" style="color: currentcolor;"><path fill-rule="evenodd" clip-rule="evenodd" d="M11.5 9.75V11.25C11.5 11.3881 11.3881 11.5 11.25 11.5H4.75C4.61193 11.5 4.5 11.3881 4.5 11.25L4.5 4.75C4.5 4.61193 4.61193 4.5 4.75 4.5H6.25H7V3H6.25H4.75C3.7835 3 3 3.7835 3 4.75V11.25C3 12.2165 3.7835 13 4.75 13H11.25C12.2165 13 13 12.2165 13 11.25V9.75V9H11.5V9.75ZM8.5 3H9.25H12.2495C12.6637 3 12.9995 3.33579 12.9995 3.75V6.75V7.5H11.4995V6.75V5.56066L8.53033 8.52978L8 9.06011L6.93934 7.99945L7.46967 7.46912L10.4388 4.5H9.25H8.5V3Z" fill="currentColor"></path></svg></SteamMobileLink></EmptyStateSubHeader>
            </Show>
        </EmptyState>
    )
}