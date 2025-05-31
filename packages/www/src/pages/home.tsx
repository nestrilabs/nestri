import { keyframes } from "@macaron-css/core";
import { styled } from "@macaron-css/solid";
import { Container, Screen as FullScreen, theme } from "@nestri/www/ui";

const Background = styled("div", {
    base: {
        position: "fixed",
        zIndex: "-1",
        inset: 0,
        ":after": {
            inset: 0,
            content: "",
            userSelect: "none",
            position: "absolute",
            pointerEvents: "none",
            background: `linear-gradient(0deg,${theme.color.background.d200} 30%,transparent),linear-gradient(0deg,${theme.color.background.d200} 30%,transparent)`
        }
    }
})

const gradient = keyframes({
    "0%": {
        backgroundPosition: "0% 50%",
    },
    "50%": {
        backgroundPosition: "100% 50%",
    },
    "100%": {
        backgroundPosition: "0% 50%",
    },
})

const BackgroundImage = styled("div", {
    base: {
        width: "100%",
        height: "70%",
        position: "relative",
        filter: "saturate(120%)",
        backgroundSize: "300% 100%",
        backgroundPosition: "0% 0%",
        backgroundRepeat: "repeat-x",
        animation: `${gradient} 35s linear 0s infinite`,
        backgroundImage: "linear-gradient(120deg, rgb(232,23,98) 1.26%, rgb(30,134,248) 18.6%, rgb(91,108,255) 34.56%, rgb(52,199,89) 49.76%, rgb(245,197,5) 64.87%, rgb(236,62,62) 85.7%)",
    }
})

const Wrapper = styled("div", {
    base: {
        margin: "100px 0",
        textAlign: "center",
        justifyContent:"center",
        display:"flex",
        flexDirection:"column",
        width: "100%",
        maxWidth: 700,
    }
})

const Title = styled("h1", {
    base: {
        fontSize: "50px",
        fontFamily: theme.font.family.heading,
        letterSpacing: "-0.515px",

    }
})

const Profiles = styled("div", {
    base: {
        display: "flex",
        width: "100%",
        flexWrap: "wrap",
        margin: "100px 0",
        justifyContent: "space-between"
    }
})

const Profile = styled("div", {
    base: {
        width: 150
    }
})

const ProfilePicture = styled("div", {
    base: {
        width: 150,
        height: 150,
        borderRadius: 75,
        overflow: "hidden",
        border: `6px solid ${theme.color.gray.d900}`,
        transition: "all 300ms ease"
    }
})

const ProfileName = styled("div", {
    base: {
        margin: "20px 0",
        lineHeight: "1.25em",
        color: theme.color.gray.d900,
        transition: "all 300ms ease",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        fontSize: theme.font.size.lg
    }
})

const NewButton = styled("div", {
    base: {
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        cursor: "pointer",
        padding: "0px 14px",
        gap: 10,
        width:"max-content",
        alignSelf:"center",
        height: 48,
        borderRadius: theme.space["2"],
        backgroundColor: theme.color.background.d100,
        border: `1px solid ${theme.color.gray.d400}`
    }
})

export function HomeRoute() {
    return (
        <FullScreen>
            <Container
                vertical="center"
                horizontal="center"
                style={{ position: "fixed", height: "100%", width: "100%" }} >
                <Background>
                    <BackgroundImage />
                </Background>
                <Wrapper>
                    <Title>
                        Who's playing?
                    </Title>
                    <Profiles>
                        <Profile>
                            <ProfilePicture>
                                <img src="https://avatars.cloudflare.steamstatic.com/c55b317fdf7d85e3179a0998090790448e597fcb_full.jpg" style={{ height: "100%", width: "100%" }} />
                            </ProfilePicture>
                            <ProfileName>Wanjohi</ProfileName>
                        </Profile><Profile>
                            <ProfilePicture>
                                <img src="https://avatars.cloudflare.steamstatic.com/c55b317fdf7d85e3179a0998090790448e597fcb_full.jpg" style={{ height: "100%", width: "100%" }} />
                            </ProfilePicture>
                            <ProfileName>Wanjohi</ProfileName>
                        </Profile><Profile>
                            <ProfilePicture>
                                <img src="https://avatars.cloudflare.steamstatic.com/c55b317fdf7d85e3179a0998090790448e597fcb_full.jpg" style={{ height: "100%", width: "100%" }} />
                            </ProfilePicture>
                            <ProfileName>Wanjohi</ProfileName>
                        </Profile><Profile>
                            <ProfilePicture>
                                <img src="https://avatars.cloudflare.steamstatic.com/c55b317fdf7d85e3179a0998090790448e597fcb_full.jpg" style={{ height: "100%", width: "100%" }} />
                            </ProfilePicture>
                            <ProfileName>WanjohiRyan</ProfileName>
                        </Profile>
                    </Profiles>
                    <NewButton>
                        Link Steam Account
                    </NewButton>
                </Wrapper>
            </Container>
        </FullScreen>
    )
}