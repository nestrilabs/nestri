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
        backgroundPosition: "50% 100%",
    },
    "50%": {
        backgroundPosition: "50% 50%",
    },
    "100%": {
        backgroundPosition: "100% 50%",
    }
})

const BackgroundImage = styled("div", {
    base: {
        position: "relative",
        background: "linear-gradient(120deg,#32eaff 20%,#f644ff 50%,#ff822e 70%)",
        width: "100%",
        height: "70%",
        animation: `${gradient} 2s infinite alternate`,
        backgroundSize: "300%",
        filter: "saturate(120%)"
    }
})

const Wrapper = styled("div", {
    base: {
        margin: "100px 0",
        textAlign: "center",
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
        color: theme.color.gray.d900,
        transition: "all 300ms ease",
        margin: "20px 0",
        lineHeight: "1.25em",
        fontSize: theme.font.size.lg
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
                            <ProfileName>Wanjohi</ProfileName>
                        </Profile>
                    </Profiles>
                </Wrapper>
            </Container>
        </FullScreen>
    )
}