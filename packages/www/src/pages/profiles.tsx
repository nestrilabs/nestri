import { For } from "solid-js";
import { A } from "@solidjs/router";
import { styled } from "@macaron-css/solid";
import { keyframes } from "@macaron-css/core";
import { useAccount } from "../providers/account";
import SteamAvatar from "../components/profile-picture";
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
        justifyContent: "center",
        display: "flex",
        flexDirection: "column",
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
        // width: "100%",
        gridTemplateColumns: "repeat(auto-fit, minmax(150px, auto))",
        display: "grid",
        columnGap: 12,
        rowGap: 10,
        margin: "100px 0",
        alignItems: "center",
        justifyContent: "center"
    }
})

const Profile = styled("div", {
    base: {
        width: 150,
    }
})

const ProfilePicture = styled("div", {
    base: {
        width: 150,
        height: 150,
        cursor: "pointer",
        borderRadius: 75,
        overflow: "hidden",
        border: `6px solid ${theme.color.gray.d700}`,
        transition: "all 200ms ease",
        ":hover": {
            transform: "scale(1.07)",
            borderColor: theme.color.blue.d700
        }
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

const NewButton = styled(A, {
    base: {
        display: "flex",
        justifyContent: "center",
        textDecoration: "none",
        alignItems: "center",
        cursor: "pointer",
        color: "inherit",
        padding: "0px 14px",
        gap: 10,
        width: "max-content",
        alignSelf: "center",
        height: 48,
        borderRadius: theme.space["3"],
        transition: "all .2s ease",
        border: `1px solid ${theme.color.gray.d400}`,
        backgroundColor: theme.color.background.d100,
        ":hover": {
            transform: "scale(1.02)",
            borderColor: theme.color.blue.d700
        }
    }
})

export function ProfilesRoute() {
    const account = useAccount()
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
                        <For each={account.current.profiles}>
                            {(profile) => (
                                <Profile>
                                    <ProfilePicture>
                                        <SteamAvatar avatarHash={profile.avatarHash} />
                                    </ProfilePicture>
                                    <ProfileName>{profile.name}</ProfileName>
                                </Profile>
                            )}
                        </For>
                    </Profiles>
                    <NewButton href="/new" >
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><g fill="none"><path d="m12.594 23.258l-.012.002l-.071.035l-.02.004l-.014-.004l-.071-.036q-.016-.004-.024.006l-.004.01l-.017.428l.005.02l.01.013l.104.074l.015.004l.012-.004l.104-.074l.012-.016l.004-.017l-.017-.427q-.004-.016-.016-.018m.264-.113l-.014.002l-.184.093l-.01.01l-.003.011l.018.43l.005.012l.008.008l.201.092q.019.005.029-.008l.004-.014l-.034-.614q-.005-.019-.02-.022m-.715.002a.02.02 0 0 0-.027.006l-.006.014l-.034.614q.001.018.017.024l.015-.002l.201-.093l.01-.008l.003-.011l.018-.43l-.003-.012l-.01-.01z" /><path fill="currentColor" d="M6 7a5 5 0 1 1 10 0A5 5 0 0 1 6 7m-1.178 7.672C6.425 13.694 8.605 13 11 13q.671 0 1.316.07a1 1 0 0 1 .72 1.557A5.97 5.97 0 0 0 12 18c0 .92.207 1.79.575 2.567a1 1 0 0 1-.89 1.428L11 22c-2.229 0-4.335-.14-5.913-.558c-.785-.208-1.524-.506-2.084-.956C2.41 20.01 2 19.345 2 18.5c0-.787.358-1.523.844-2.139c.494-.625 1.177-1.2 1.978-1.69ZM18 14a1 1 0 0 1 1 1v2h2a1 1 0 1 1 0 2h-2v2a1 1 0 1 1-2 0v-2h-2a1 1 0 1 1 0-2h2v-2a1 1 0 0 1 1-1" /></g></svg>
                        Add Steam account
                    </NewButton>
                </Wrapper>
            </Container>
        </FullScreen>
    )
}