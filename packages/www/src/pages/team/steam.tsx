import { Header } from "./header"
import { theme } from "@nestri/www/ui";
import { Text } from "@nestri/www/ui";
import { styled } from "@macaron-css/solid";
import { useSteam } from "@nestri/www/providers/steam";
import { createEffect, onCleanup } from "solid-js";

// FIXME: Remove this route, or move it to machines

// The idea has changed, let the user login to Steam from the / route
// Let the machines route remain different from the main page
// Why? It becomes much simpler for routing and onboarding, plus how often will you move to the machines route?
// Now it will be the home page's problem with making sure the user can download and install games on whatever machine they need/want

const Root = styled("div", {
    base: {
        display: "grid",
        gridAutoRows: "1fr",
        position: "relative",
        gridTemplateRows: "0 auto",
        backgroundColor: theme.color.background.d200,
        minHeight: `calc(100vh - ${theme.headerHeight.root})`,
        gridTemplateColumns: "minmax(24px,1fr) minmax(0,1000px) minmax(24px,1fr)"
    },
});

const Section = styled("section", {
    base: {
        gridColumn: "1/-1",
    }
})

const TitleHeader = styled("header", {
    base: {
        borderBottom: `1px solid ${theme.color.gray.d400}`,
        color: theme.color.d1000.gray
    }
})

const TitleWrapper = styled("div", {
    base: {
        width: "calc(1000px + calc(2 * 24px))",
        paddingLeft: "24px",
        display: "flex",
        paddingRight: "24px",
        marginLeft: "auto",
        marginRight: "auto",
        maxWidth: "100%"
    }
})

const TitleContainer = styled("div", {
    base: {
        margin: "40px 0",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        width: "100%",
        minWidth: 0
    }
})

const ButtonContainer = styled("div", {
    base: {
        display: "flex",
        flexDirection: "row",
        gap: 16,
        margin: "40px 0",
    }
})

const Title = styled("h1", {
    base: {
        lineHeight: "2.5rem",
        fontWeight: theme.font.weight.semibold,
        letterSpacing: "-0.069375rem",
        fontSize: theme.font.size["4xl"],
        textTransform: "capitalize"
    }
})

const Description = styled("p", {
    base: {
        fontSize: theme.font.size.sm,
        lineHeight: "1.25rem",
        fontWeight: theme.font.weight.regular,
        letterSpacing: "initial",
        color: theme.color.gray.d900
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

const Body = styled("div", {
    base: {
        padding: "0 24px",
        width: "calc(1000px + calc(2 * 24px))",
        minWidth: "calc(100vh - 273px)",
        margin: "24px auto"
    }
})

const GamesContainer = styled("div", {
    base: {
        background: theme.color.background.d200,
        padding: "32px 16px",
        borderRadius: 5,
        border: `1px solid ${theme.color.gray.d400}`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        height: "calc(100vh - 300px)",
    }
})

const EmptyState = styled("div", {
    base: {
        height: "100%",
        width: "100%",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        gap: theme.space[8],
        flexDirection: "column"
    }
})

const SteamLogoContainer = styled("div", {
    base: {
        height: 60,
        width: 60,
        padding: 4,
        borderRadius: 8,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: theme.color.background.d200,
        border: `1px solid ${theme.color.gray.d400}`,
    }
})
export function SteamRoute() {
    const steam = useSteam();

    createEffect(() => {
        // steam.client.loginStream.connect();

        // Clean up on component unmount
        // onCleanup(() => {
        //     steam.client.loginStream.disconnect();
        // });
    });

    return (
        <>
            <Header />
            <Root>
                <Section>
                    <TitleHeader>
                        <TitleWrapper>
                            <TitleContainer>
                                <Title>
                                    Steam Library
                                </Title>
                                <Description>
                                    {/* Read and write directly to databases and stores from your projects. */}
                                    Install games directly from your Steam account to your Nestri Machine
                                </Description>
                            </TitleContainer>
                            <ButtonContainer>
                                <QRButton>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 32 32">
                                        <path fill="currentColor" d="M15.974 0C7.573 0 .682 6.479.031 14.714l8.573 3.547a4.5 4.5 0 0 1 2.552-.786c.083 0 .167.005.25.005l3.813-5.521v-.078c0-3.328 2.703-6.031 6.031-6.031s6.036 2.708 6.036 6.036a6.04 6.04 0 0 1-6.036 6.031h-.135l-5.438 3.88c0 .073.005.141.005.214c0 2.5-2.021 4.526-4.521 4.526c-2.177 0-4.021-1.563-4.443-3.635L.583 20.36c1.901 6.719 8.063 11.641 15.391 11.641c8.833 0 15.995-7.161 15.995-16s-7.161-16-15.995-16zm-5.922 24.281l-1.964-.813a3.4 3.4 0 0 0 1.755 1.667a3.404 3.404 0 0 0 4.443-1.833a3.38 3.38 0 0 0 .005-2.599a3.36 3.36 0 0 0-1.839-1.844a3.38 3.38 0 0 0-2.5-.042l2.026.839c1.276.536 1.88 2 1.349 3.276s-2 1.88-3.276 1.349zm15.219-12.406a4.025 4.025 0 0 0-4.016-4.021a4.02 4.02 0 1 0 0 8.042a4.02 4.02 0 0 0 4.016-4.021m-7.026-.005c0-1.672 1.349-3.021 3.016-3.021s3.026 1.349 3.026 3.021c0 1.667-1.359 3.021-3.026 3.021s-3.016-1.354-3.016-3.021" />
                                    </svg>
                                    <ButtonText>
                                        Connect Steam
                                    </ButtonText>
                                </QRButton>
                            </ButtonContainer>
                        </TitleWrapper>
                    </TitleHeader>
                    <Body>
                        <GamesContainer>
                            <EmptyState>
                                <SteamLogoContainer>
                                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
                                        <path fill="currentColor" d="M15.974 0C7.573 0 .682 6.479.031 14.714l8.573 3.547a4.5 4.5 0 0 1 2.552-.786c.083 0 .167.005.25.005l3.813-5.521v-.078c0-3.328 2.703-6.031 6.031-6.031s6.036 2.708 6.036 6.036a6.04 6.04 0 0 1-6.036 6.031h-.135l-5.438 3.88c0 .073.005.141.005.214c0 2.5-2.021 4.526-4.521 4.526c-2.177 0-4.021-1.563-4.443-3.635L.583 20.36c1.901 6.719 8.063 11.641 15.391 11.641c8.833 0 15.995-7.161 15.995-16s-7.161-16-15.995-16zm-5.922 24.281l-1.964-.813a3.4 3.4 0 0 0 1.755 1.667a3.404 3.404 0 0 0 4.443-1.833a3.38 3.38 0 0 0 .005-2.599a3.36 3.36 0 0 0-1.839-1.844a3.38 3.38 0 0 0-2.5-.042l2.026.839c1.276.536 1.88 2 1.349 3.276s-2 1.88-3.276 1.349zm15.219-12.406a4.025 4.025 0 0 0-4.016-4.021a4.02 4.02 0 1 0 0 8.042a4.02 4.02 0 0 0 4.016-4.021m-7.026-.005c0-1.672 1.349-3.021 3.016-3.021s3.026 1.349 3.026 3.021c0 1.667-1.359 3.021-3.026 3.021s-3.016-1.354-3.016-3.021" />
                                    </svg>
                                </SteamLogoContainer>
                                <Text align="center" style={{ "letter-spacing": "-0.3px" }} size="base" >
                                    {/* After connecting your Steam account, your games will appear here */}
                                    {/* URL: {steam.client.loginStream.loginUrl()} */}
                                </Text>
                            </EmptyState>
                        </GamesContainer>
                    </Body>
                </Section>
            </Root>
        </>
    )
}