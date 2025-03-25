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

const LastPlayedWrapper = styled("div", {
    base: {
        position: "relative",
        width: "100%",
        justifyContent: "center",
        minHeight: 700,
        height: "50vw",
        maxHeight: 800,
        WebkitBoxPack: "center",
        display: "flex",
        flexDirection: "column",
        ":after": {
            content: "",
            pointerEvents: "none",
            userSelect: "none",
            background: `linear-gradient(to bottom,transparent,${theme.color.background.d200})`,
            width: "100%",
            left: 0,
            position: "absolute",
            bottom: -1,
            zIndex: 3,
            height: 320,
            backdropFilter: "blur(2px)",
            WebkitBackdropFilter: "blur(1px)",
            WebkitMaskImage: `linear-gradient(to top,${theme.color.background.d200} 25%,transparent)`,
            maskImage: `linear-gradient(to top,${theme.color.background.d200} 25%,transparent)`
        }
    }
})

const LastPlayedFader = styled("div", {
    base: {
        position: "absolute",
        width: "100%",
        height: "3rem",
        backgroundColor: "rgba(0,0,0,.08)",
        mixBlendMode: "multiply",
        backdropFilter: "saturate(160%) blur(60px)",
        WebkitBackdropFilter: "saturate(160%) blur(60px)",
        maskImage: "linear-gradient(to top,rgba(0,0,0,.15) 0%,rgba(0,0,0,.65) 57.14%,rgba(0,0,0,.9) 67.86%,#000 79.08%)",
        // background: "linear-gradient(rgb(0, 0, 0) 0%, rgba(0, 0, 0, 0.3) 50%, rgba(10, 0, 0, 0.15) 65%, rgba(0, 0, 0, 0.075) 75.5%, rgba(0, 0, 0, 0.035) 82.85%, rgba(0, 0, 0, 0.02) 88%, rgba(0, 0, 0, 0) 100%)",
        opacity: 0.6,
        // backdropFilter: "blur(16px)",
        pointerEvents: "none",
        zIndex: 1,
        top: 0,
        left: 0,
    }
})

const BackgroundImage = styled("div", {
    base: {
        position: "fixed",
        inset: 0,
        backgroundColor: theme.color.background.d200,
        backgroundSize: "cover",
        zIndex: 0,
        transitionDuration: "0.2s",
        transitionTimingFunction: "cubic-bezier(0.4,0,0.2,1)",
        transitionProperty: "opacity",
        backgroundImage: "url(https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/1203190/ss_97ea9b0b5a6adf3436b31d389cd18d3a647ee4bf.jpg)"
        // backgroundImage: "url(https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/3373660/c4993923f605b608939536b5f2521913850b028a/ss_c4993923f605b608939536b5f2521913850b028a.jpg)"
    }
})

const LogoBackgroundImage = styled("div", {
    base: {
        position: "fixed",
        top: "2rem",
        height: 240,
        // width: 320,
        aspectRatio: "16 / 9",
        left: "50%",
        transform: "translate(-50%,0%)",
        backgroundSize: "cover",
        zIndex: 1,
        transitionDuration: "0.2s",
        transitionTimingFunction: "cubic-bezier(0.4,0,0.2,1)",
        transitionProperty: "opacity",
        backgroundImage: "url(https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/1203190/logo_2x.png)"
    }
})

const Material = styled("div", {
    base: {
        backdropFilter: "saturate(160%) blur(60px)",
        WebkitBackdropFilter: "saturate(160%) blur(60px)",
        backgroundSize: "cover",
        backgroundRepeat: "no-repeat",
        position: "absolute",
        borderRadius: 6,
        left: 0,
        top: 0,
        height: "100%",
        width: "100%",
        maskImage: "linear-gradient(180deg,rgba(0,0,0,0) 0,rgba(0,0,0,0) 40.82%,rgba(0,0,0,.15) 50%,rgba(0,0,0,.65) 57.14%,rgba(0,0,0,.9) 67.86%,#000 79.08%)",
        WebkitMaskImage: "linear-gradient(180deg,rgba(0,0,0,0) 0,rgba(0,0,0,0) 40.82%,rgba(0,0,0,.15) 50%,rgba(0,0,0,.65) 57.14%,rgba(0,0,0,.9) 67.86%,#000 79.08%)"
    }
})

const JoeColor = styled("div", {
    base: {
        backgroundColor: "rgba(0,0,0,.08)",
        mixBlendMode: "multiply",
        position: "absolute",
        borderRadius: 6,
        left: 0,
        top: 0,
        height: "100%",
        width: "100%",
        maskImage: "linear-gradient(180deg,rgba(0,0,0,0) 0,rgba(0,0,0,0) 40.82%,rgba(0,0,0,.15) 50%,rgba(0,0,0,.65) 57.14%,rgba(0,0,0,.9) 67.86%,#000 79.08%)",
        WebkitMaskImage: "linear-gradient(180deg,rgba(0,0,0,0) 0,rgba(0,0,0,0) 40.82%,rgba(0,0,0,.15) 50%,rgba(0,0,0,.65) 57.14%,rgba(0,0,0,.9) 67.86%,#000 79.08%)"
    }
})

const GamesContainer = styled("div", {
    base: {
        width: "100%",
        display: "flex",
        alignItems: "center",
        flexDirection: "column",
        zIndex: 3,
        backgroundColor: theme.color.background.d200,
    }
})

const GamesWrapper = styled("div", {
    base: {
        maxWidth: "70vw",
        width: "100%",
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        margin: "0 auto",
        display: "grid",
        marginTop: -80,
        columnGap: 12,
        rowGap: 10
    }
})

const GameImage = styled("img", {
    base: {
        width: "100%",
        height: "100%",
        aspectRatio: "460/215",
        borderRadius: 10,
    }
})

const GameSquareImage = styled("img", {
    base: {
        width: "100%",
        height: "100%",
        aspectRatio: "1/1",
        borderRadius: 10,
        transitionDuration: "0.2s",
        transitionTimingFunction: "cubic-bezier(0.4,0,0.2,1)",
        transitionProperty: "all",
        cursor: "pointer",
        border: `2px solid transparent`,
        ":hover": {
            transform: "scale(1.05)",
            outline: `2px solid ${theme.color.brand}`
        }
    }
})

const GameImageCapsule = styled("img", {
    base: {
        width: "100%",
        height: "100%",
        aspectRatio: "374/448",
        borderRadius: 10,
    }
})

const SteamLibrary = styled("div", {
    base: {
        borderTop: `1px solid ${theme.color.gray.d400}`,
        padding: "20px 0",
        margin: "20px auto",
        width: "100%",
        display: "grid",
        // backgroundColor: "red",
        maxWidth: "70vw",
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        columnGap: 12,
        rowGap: 10,
    }
})

const SteamLibraryTitle = styled("h3", {
    base: {
        textAlign: "left",
        fontFamily: theme.font.family.heading,
        fontWeight: theme.font.weight.medium,
        fontSize: theme.font.size["2xl"],
        letterSpacing: -0.7,
        gridColumn: "1/-1",
        marginBottom: 20,
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
            <Header whiteColor>
                <FullScreen >
                    <EmptyState
                        style={{
                            "--nestri-qr-dot-color": theme.color.d1000.gray,
                            "--nestri-body-background": theme.color.gray.d100
                        }}
                    >
                        <QRWrapper>
                            <LogoContainer>
                                <LogoIcon
                                    xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 16 16">
                                    <g fill="currentColor">
                                        <path d="M.329 10.333A8.01 8.01 0 0 0 7.99 16C12.414 16 16 12.418 16 8s-3.586-8-8.009-8A8.006 8.006 0 0 0 0 7.468l.003.006l4.304 1.769A2.2 2.2 0 0 1 5.62 8.88l1.96-2.844l-.001-.04a3.046 3.046 0 0 1 3.042-3.043a3.046 3.046 0 0 1 3.042 3.043a3.047 3.047 0 0 1-3.111 3.044l-2.804 2a2.223 2.223 0 0 1-3.075 2.11a2.22 2.22 0 0 1-1.312-1.568L.33 10.333Z" /><path d="M4.868 12.683a1.715 1.715 0 0 0 1.318-3.165a1.7 1.7 0 0 0-1.263-.02l1.023.424a1.261 1.261 0 1 1-.97 2.33l-.99-.41a1.7 1.7 0 0 0 .882.84Zm3.726-6.687a2.03 2.03 0 0 0 2.027 2.029a2.03 2.03 0 0 0 2.027-2.029a2.03 2.03 0 0 0-2.027-2.027a2.03 2.03 0 0 0-2.027 2.027m2.03-1.527a1.524 1.524 0 1 1-.002 3.048a1.524 1.524 0 0 1 .002-3.048" />
                                    </g>
                                </LogoIcon>
                            </LogoContainer>
                            <QRCode
                                uri={"https://github.com/family/connectkit/blob/9a3c16c781d8a60853eff0c4988e22926a3f91ce"}
                                size={180}
                                ecl="M"
                                clearArea={true}
                            />
                        </QRWrapper>
                        <EmptyStateHeader>Sign in to your Steam account</EmptyStateHeader>
                        <EmptyStateSubHeader>Use your Steam Mobile App to sign in via QR code.&nbsp;<SteamMobileLink href="https://store.steampowered.com/mobile" target="_blank">Learn More<svg data-testid="geist-icon" height="20" stroke-linejoin="round" viewBox="0 0 16 16" width="20" style="color: currentcolor;"><path fill-rule="evenodd" clip-rule="evenodd" d="M11.5 9.75V11.25C11.5 11.3881 11.3881 11.5 11.25 11.5H4.75C4.61193 11.5 4.5 11.3881 4.5 11.25L4.5 4.75C4.5 4.61193 4.61193 4.5 4.75 4.5H6.25H7V3H6.25H4.75C3.7835 3 3 3.7835 3 4.75V11.25C3 12.2165 3.7835 13 4.75 13H11.25C12.2165 13 13 12.2165 13 11.25V9.75V9H11.5V9.75ZM8.5 3H9.25H12.2495C12.6637 3 12.9995 3.33579 12.9995 3.75V6.75V7.5H11.4995V6.75V5.56066L8.53033 8.52978L8 9.06011L6.93934 7.99945L7.46967 7.46912L10.4388 4.5H9.25H8.5V3Z" fill="currentColor"></path></svg></SteamMobileLink></EmptyStateSubHeader>
                    </EmptyState>
                    {/* <LastPlayedWrapper>
                        <LastPlayedFader />
                        <LogoBackgroundImage />
                        <BackgroundImage />
                        <Material />
                        <JoeColor />
                    </LastPlayedWrapper> */}
                    {/* <GamesContainer>
                        <GamesWrapper>
                            <GameSquareImage alt="Assasin's Creed Shadows" src="https://assets-prd.ignimgs.com/2024/05/15/acshadows-1715789601294.jpg" />
                            <GameSquareImage alt="Assasin's Creed Shadows" src="https://assets-prd.ignimgs.com/2022/09/22/slime-rancher-2-button-02-1663890048548.jpg" />
                            <GameSquareImage alt="Assasin's Creed Shadows" src="https://assets-prd.ignimgs.com/2023/05/19/cataclismo-button-1684532710313.jpg" />
                            <GameSquareImage alt="Assasin's Creed Shadows" src="https://assets-prd.ignimgs.com/2024/03/27/marvelrivals-1711557092104.jpg" />
                        </GamesWrapper>
                        <SteamLibrary>
                            <SteamLibraryTitle>Games we think you will like</SteamLibraryTitle>
                            <GameImageCapsule alt="Assasin's Creed Shadows" src="https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/2625420/hero_capsule.jpg?t=1742853642" />
                            <GameImageCapsule alt="Assasin's Creed Shadows" src="https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/2486740/hero_capsule.jpg?t=1742596243" />
                            <GameImageCapsule alt="Assasin's Creed Shadows" src="https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/870780/hero_capsule.jpg?t=1737800535" />
                            <GameImageCapsule alt="Assasin's Creed Shadows" src="https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/2050650/hero_capsule.jpg?t=1737800535" />
                        </SteamLibrary>
                    </GamesContainer> */}
                </FullScreen>
            </Header>
        </>
    )
}