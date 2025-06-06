import { FullScreen, theme } from "@nestri/www/ui";
import { styled } from "@macaron-css/solid";
import { Header } from "@nestri/www/pages/steam/header";
import { Modal } from "@nestri/www/ui/modal";
import { createEffect, createSignal, Match, onCleanup, Switch } from "solid-js";
import { Text } from "@nestri/www/ui/text"
import { globalStyle, keyframes } from "@macaron-css/core";
import { A } from "@solidjs/router";
import Avatar from "@nestri/www/ui/avatar";
import { Portal } from "@nestri/www/common/portal";
import { QrCodeComponent } from "@nestri/www/components"


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
        zIndex: 10,
        isolation: "isolate",
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
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        columnGap: 20,
        rowGap: 10,
    }
})

const Title = styled("h3", {
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

const SteamGameTitle = styled("h3", {
    base: {
        textAlign: "left",
        fontFamily: theme.font.family.heading,
        fontWeight: theme.font.weight.medium,
        fontSize: theme.font.size["xl"],
        letterSpacing: -0.7,
    }
})

const SteamGameSubTitle = styled("span", {
    base: {
        textAlign: "left",
        fontWeight: theme.font.weight.regular,
        color: theme.color.gray.d900,
        fontSize: theme.font.size["base"],
        letterSpacing: -0.4,
    }
})

const SubTitle = styled("span", {
    base: {
        textAlign: "left",
        fontWeight: theme.font.weight.regular,
        color: theme.color.gray.d900,
        fontSize: theme.font.size["base"],
        letterSpacing: -0.4,
        gridColumn: "1/-1",
        marginTop: -20,
        marginBottom: 20,
    }
})

const FriendsList = styled("div", {
    base: {
        borderTop: `1px solid ${theme.color.gray.d400}`,
        padding: "20px 0",
        margin: "20px auto",
        width: "100%",
        display: "grid",
        maxWidth: "70vw",
        gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
        columnGap: 12,
        rowGap: 10,
    }
})

const FriendContainer = styled("div", {
    base: {
        width: "100%",
        display: "flex",
        minHeight: "calc(100% + 20px)",
        aspectRatio: "300/380",
        borderRadius: 15,
        position: "relative",
        padding: "35px 17px",
        border: `1px solid ${theme.color.gray.d500}`,
        backgroundColor: theme.color.background.d100,
        flexDirection: "column",
        alignItems: "center",
    }
})

const FriendsSubText = styled("span", {
    base: {
        color: theme.color.gray.d900,
        fontSize: theme.font.size.sm,
        marginTop: 10,
    }
})
const FriendsText = styled("h3", {
    base: {
        fontSize: theme.font.size["lg"],
        fontFamily: theme.font.family.heading,
        marginTop: 20,
    }
})

const FriendsInviteButton = styled("button", {
    base: {
        minWidth: 48,
        borderRadius: 9999,
        textAlign: "center",
        padding: "0px 24px",
        fontSize: theme.font.size["base"],
        lineHeight: "1.75",
        marginTop: 20,
        cursor: "pointer",
        fontWeight: theme.font.weight.bold,
        fontFamily: theme.font.family.heading,
        border: `1px solid ${theme.color.gray.d100}`,
        backgroundColor: theme.color.blue.d700,
        transition: "all 0.2s cubic-bezier(0.4,0,0.2,1)",
        ":hover": {
            transform: "scale(1.05)"
        }
    }
})

const SteamGameContainer = styled("div", {
    base: {
        padding: "20px 0",
        width: "100%",
        minHeight: 72,
        display: "flex",
        flexDirection: "row",
        selectors: {
            "&:not(:last-of-type)": {
                borderBottom: `1px solid ${theme.color.gray.d400}`
            },
            "&:not(:first-of-type)": {
                borderTop: `1px solid ${theme.color.gray.d400}`
            }
        }
    }
})

const SteamGameImg = styled("img", {
    base: {
        border: "none",
        outline: "none",
        aspectRatio: "1/1",
        height: 80,
        borderRadius: 8
    }
})

const SteamGameText = styled("div", {
    base: {
        paddingRight: "3em",
        marginLeft: 30,
        display: "flex",
        gap: 8,
        flexDirection: "column",
        alignSelf: "center",
    }
})
const SteamGameBtn = styled("button", {
    base: {
        minWidth: 48,
        borderRadius: 9999,
        textAlign: "center",
        padding: "0px 24px",
        fontSize: theme.font.size["base"],
        lineHeight: "1.75",
        // marginTop: 20,
        // marginRight: 1,
        margin: "0 1px 0 auto",
        cursor: "pointer",
        alignSelf: "center",
        fontWeight: theme.font.weight.bold,
        fontFamily: theme.font.family.heading,
        color: theme.color.blue.d900,
        border: `1px solid ${theme.color.gray.d100}`,
        backgroundColor: theme.color.blue.d300,
        transition: "all 0.2s cubic-bezier(0.4,0,0.2,1)",
        ":hover": {
            transform: "scale(1.05)"
        }
    }
})

const PortalContainer = styled("div", {
    base: {
        zIndex: 4,
        isolation: "isolate",
        position: "fixed",
        bottom: "20vh",
        left: "50%",
        transform: "translateX(-50%)"
    }
})

/**
 * Renders the home page layout for the gaming platform.
 *
 * This component wraps its content within a header and a full-screen container,
 * currently displaying a QR code component. Commented sections indicate planned
 * enhancements such as game previews, team mate suggestions, and a Steam library.
 */
export function HomeRoute() {

    return (
        <>
            <Header>
                <FullScreen >
                    {/* <LastPlayedWrapper>
                        <LastPlayedFader />
                        <LogoBackgroundImage />
                        <BackgroundImage />
                        <Material />
                        <JoeColor />
                        <PortalContainer>
                            <Portal />
                        </PortalContainer>
                    </LastPlayedWrapper>
                    */}
                    <GamesContainer>
                        <GamesWrapper>
                            <GameSquareImage draggable={false} alt="Assasin's Creed Shadows" src="https://assets-prd.ignimgs.com/2024/05/15/acshadows-1715789601294.jpg" />
                            <GameSquareImage draggable={false} alt="Assasin's Creed Shadows" src="https://assets-prd.ignimgs.com/2022/09/22/slime-rancher-2-button-02-1663890048548.jpg" />
                            <GameSquareImage draggable={false} alt="Assasin's Creed Shadows" src="https://assets-prd.ignimgs.com/2023/05/19/cataclismo-button-1684532710313.jpg" />
                            <GameSquareImage draggable={false} alt="Assasin's Creed Shadows" src="https://assets-prd.ignimgs.com/2024/03/27/marvelrivals-1711557092104.jpg" />
                        </GamesWrapper>
                        <FriendsList>
                            <Title>Team Mate Suggestions</Title>
                            <SubTitle>Invite people to join your team and play together</SubTitle>
                            <FriendContainer>
                                <Avatar size={100} name="Wanjohi Ryan" />
                                <FriendsText>Wanjohi Ryan</FriendsText>
                                <FriendsSubText>From your Steam Friends</FriendsSubText>
                                <FriendsInviteButton>Invite</FriendsInviteButton>
                            </FriendContainer>
                            <FriendContainer>
                                <Avatar size={100} name="Tracy Jones" />
                                <FriendsText>Tracy Jones</FriendsText>
                                <FriendsSubText>From your Steam Friends</FriendsSubText>
                                <FriendsInviteButton>Invite</FriendsInviteButton>
                            </FriendContainer>
                            <FriendContainer>
                                <Avatar size={100} name="The65th" />
                                <FriendsText>The65th</FriendsText>
                                <FriendsSubText>From your Steam Friends</FriendsSubText>
                                <FriendsInviteButton>Invite</FriendsInviteButton>
                            </FriendContainer>
                            <FriendContainer>
                                <Avatar size={100} name="Menstral" />
                                <FriendsText>Menstral</FriendsText>
                                <FriendsSubText>From your Steam Friends</FriendsSubText>
                                <FriendsInviteButton>Invite</FriendsInviteButton>
                            </FriendContainer>
                            <FriendContainer>
                                <Avatar size={100} name="AstroHot" />
                                <FriendsText>AstroHot</FriendsText>
                                <FriendsSubText>From your Steam Friends</FriendsSubText>
                                <FriendsInviteButton>Invite</FriendsInviteButton>
                            </FriendContainer>
                        </FriendsList>
                        <SteamLibrary>
                            <Title>Your Steam library</Title>
                            <SubTitle>These titles from your Steam Library are fully functional on Nestri</SubTitle>
                            <div>
                                <SteamGameContainer>
                                    <SteamGameImg draggable={false} src="https://assets-prd.ignimgs.com/2023/05/27/alanwake2-1685200534966.jpg" />
                                    <SteamGameText>
                                        <SteamGameTitle>Alan Wake II</SteamGameTitle>
                                        <SteamGameSubTitle>Action, Adventure, Horror</SteamGameSubTitle>
                                    </SteamGameText>
                                    <SteamGameBtn>Install</SteamGameBtn>
                                </SteamGameContainer>
                                <SteamGameContainer>
                                    <SteamGameImg draggable={false} src="https://assets-prd.ignimgs.com/2022/09/22/slime-rancher-2-button-02-1663890048548.jpg" />
                                    <SteamGameText>
                                        <SteamGameTitle>Slime Rancher 2</SteamGameTitle>
                                        <SteamGameSubTitle>Action, Adventure, Casual, Indie</SteamGameSubTitle>
                                    </SteamGameText>
                                    <SteamGameBtn>Install</SteamGameBtn>
                                </SteamGameContainer>
                                <SteamGameContainer>
                                    <SteamGameImg draggable={false} src="https://assets1.ignimgs.com/2019/07/17/doom-eternal---button-fin-1563400339680.jpg" />
                                    <SteamGameText>
                                        <SteamGameTitle>Doom Eternal</SteamGameTitle>
                                        <SteamGameSubTitle>Action</SteamGameSubTitle>
                                    </SteamGameText>
                                    <SteamGameBtn>Install</SteamGameBtn>
                                </SteamGameContainer>
                            </div>
                            <div>
                                <SteamGameContainer>
                                    <SteamGameImg draggable={false} src="https://assets-prd.ignimgs.com/2022/10/12/dead-space-2023-button-3-1665603079064.jpg" />
                                    <SteamGameText>
                                        <SteamGameTitle>Dead Space</SteamGameTitle>
                                        <SteamGameSubTitle>Action, Adventure</SteamGameSubTitle>
                                    </SteamGameText>
                                    <SteamGameBtn>Update</SteamGameBtn>
                                </SteamGameContainer>
                                <SteamGameContainer>
                                    <SteamGameImg draggable={false} src="https://assets-prd.ignimgs.com/2023/01/25/hifirush-1674680068070.jpg" />
                                    <SteamGameText>
                                        <SteamGameTitle>Hi-Fi Rush</SteamGameTitle>
                                        <SteamGameSubTitle>Action</SteamGameSubTitle>
                                    </SteamGameText>
                                    <SteamGameBtn>Install</SteamGameBtn>
                                </SteamGameContainer>
                                <SteamGameContainer>
                                    <SteamGameImg draggable={false} src="https://assets-prd.ignimgs.com/2023/08/24/baldursg3-1692894717196.jpeg" />
                                    <SteamGameText>
                                        <SteamGameTitle>Baldur's Gate 3</SteamGameTitle>
                                        <SteamGameSubTitle>Adventure, RPG, Strategy</SteamGameSubTitle>
                                    </SteamGameText>
                                    <SteamGameBtn>Install</SteamGameBtn>
                                </SteamGameContainer>
                            </div>
                        </SteamLibrary>
                    </GamesContainer>
                </FullScreen>
            </Header>
        </>
    )
}

/* 
<GameImageCapsule alt="Assasin's Creed Shadows" src="https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/2625420/hero_capsule.jpg?t=1742853642" />
<GameImageCapsule alt="Assasin's Creed Shadows" src="https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/2486740/hero_capsule.jpg?t=1742596243" />
<GameImageCapsule alt="Assasin's Creed Shadows" src="https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/870780/hero_capsule.jpg?t=1737800535" />
<GameImageCapsule alt="Assasin's Creed Shadows" src="https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/2050650/hero_capsule.jpg?t=1737800535" /> 
*/

