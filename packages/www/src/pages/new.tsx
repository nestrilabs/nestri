import { styled } from "@macaron-css/solid";
import { theme } from "@nestri/www/ui/theme";
import { useAccount } from "../providers/account";
import { Container, Screen as FullScreen } from "@nestri/www/ui/layout";
import { useNavigate } from "@solidjs/router";

const Card = styled("div", {
    base: {
        gap: 40,
        maxWidth: 400,
        width: "100%",
        display: "flex",
        padding: `10px 20px`,
        position: "relative",
        flexDirection: "column",
        justifyContent: "center",
    }
})

const LogoFooter = styled("section", {
    base: {
        position: "fixed",
        bottom: -1,
        fontSize: "100%",
        maxWidth: 1440,
        width: "100%",
        pointerEvents: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 8px",
        zIndex: 10,
        overflow: "hidden",
    },
})

const Logo = styled("svg", {
    base: {
        width: "100%",
        height: "100%",
        transform: "translateY(40%)",
        opacity: "70%",
    }
})

const Title = styled("h1", {
    base: {
        lineHeight: "2rem",
        textWrap: "balance",
        letterSpacing: "-0.029375rem",
        fontSize: theme.font.size["4xl"],
        fontFamily: theme.font.family.heading,
        fontWeight: theme.font.weight.semibold,
    }
})

const Button = styled("button", {
    base: {
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        cursor: "pointer",
        padding: "0px 14px",
        gap: 10,
        height: 48,
        borderRadius: theme.space["2"],
        backgroundColor: theme.color.background.d100,
        border: `1px solid ${theme.color.gray.d400}`
    },
    variants: {
        comingSoon: {
            true: {
                justifyContent: "space-between",
                padding: "10px 20px",
                gap: theme.space["2"],
                cursor: "not-allowed",
            }
        },
        steamBtn: {
            true: {
                color: "#FFF",
                backgroundColor: "#2D73FF"
            }
        }
    }
})

const ButtonText = styled("span", {
    base: {
        fontSize: theme.font.size["lg"],
        fontWeight: theme.font.weight.medium,
        fontFamily: theme.font.family.heading,
        position: "relative",
        display: "flex",
        alignItems: "center"
    },
})

const ButtonIcon = styled("svg", {
    base: {
        height: 28,
        width: 28,
    }
})

const ButtonContainer = styled("div", {
    base: {
        flexDirection: "column",
        display: "flex",
        gap: 10,
        position: "relative"
    }
})

const CardWrapper = styled("div", {
    base: {
        width: "100%",
        position: "relative",
        height: "max-content",
        flexDirection: "row",
        display: "flex",
        alignItems: "start",
        justifyContent: "start",
        top: "16vh"
    }
})

const Footer = styled("div", {
    base: {
        flexDirection: "column",
        display: "flex",
        gap: 10
    }
})

const Soon = styled("div", {
    base: {
        borderRadius: ".375rem",
        padding: "2px 4px",
        fontWeight: theme.font.weight.semibold,
        fontFamily: theme.font.family.heading,
        fontSize: ".625rem",
        color: theme.color.blue.d900,
        backgroundColor: theme.color.blue.d400,
        textTransform: "uppercase",
        marginLeft: 5
    }
})

const Link = styled("a", {
    base: {
        fontSize: theme.font.size["base"],
        fontWeight: theme.font.weight.regular,
        color: theme.color.gray.d900,
        textDecoration: "underline",
        textUnderlineOffset: 2
    }
})

const Divider = styled("div", {
    base: {
        display: "flex",
        whiteSpace: "nowrap",
        textAlign: "center",
        ":before": {
            width: "100%",
            content: "",
            borderTop: `1px solid ${theme.color.gray.d500}`,
            alignSelf: "center"
        },
        ":after": {
            width: "100%",
            content: "",
            borderTop: `1px solid ${theme.color.gray.d500}`,
            alignSelf: "center"
        }
    }
})

const DividerText = styled("span", {
    base: {
        margin: "0px 10px",
        fontSize: theme.font.size["xs"],
        color: theme.color.gray.d900,
        lineHeight: "20px",
        textOverflow: "ellipsis"
    }
})

export function NewProfile() {
    const nav = useNavigate();
    const account = useAccount();

    const openPopup = () => {
        const BASE_URL = import.meta.env.VITE_API_URL;

        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
            navigator.userAgent
        );

        const createDesktopWindow = (authUrl: string) => {
            const config = {
                width: 700,
                height: 700,
                features: "toolbar=no,location=no,directories=no,status=no,menubar=no,scrollbars=no,resizable=no,copyhistory=no"
            };

            const top = window.top!.outerHeight / 2 + window.top!.screenY - (config.height / 2);
            const left = window.top!.outerWidth / 2 + window.top!.screenX - (config.width / 2);

            return window.open(
                authUrl,
                'Steam Popup',
                `width=${config.width},height=${config.height},left=${left},top=${top},${config.features}`
            );
        };

        const monitorAuthWindow = (
            targetWindow: Window,
            { timeoutMs = 3 * 60 * 1000, pollInterval = 250 } = {}
        ) => {
            return new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(async() => {
                    await cleanup();
                    reject(new Error("Authentication timed out"));
                }, timeoutMs);

                const poll = setInterval(async () => {
                    if (targetWindow.closed) {
                        await cleanup();
                        resolve(); // Auth window closed by user
                    }
                }, pollInterval);

                async function cleanup() {
                    clearTimeout(timeout);
                    clearInterval(poll);
                    if (!targetWindow.closed) {
                        try {
                            targetWindow.location.href = "about:blank";
                            targetWindow.close();
                        } catch {
                            // Ignore cross-origin issues
                        }
                    }
                    await account.refresh(account.current.id)
                    nav("/profiles")
                    window.focus();
                }
            });
        };


        const authUrl = `${BASE_URL}/steam/popup/${account.current.id}`;
        const newWindow = isMobile ? window.open(authUrl, '_blank') : createDesktopWindow(authUrl);

        if (!newWindow) {
            throw new Error('Failed to open authentication window');
        }

        return monitorAuthWindow(newWindow);
    }

    return (
        <FullScreen>
            <Container
                vertical="start"
                horizontal="center"
                style={{ position: "fixed", height: "100%" }} >
                <CardWrapper>
                    <Card >
                        <Title>Connect your game library to get started</Title>
                        <ButtonContainer>
                            <Button onClick={openPopup} steamBtn>
                                <ButtonIcon
                                    xmlns="http://www.w3.org/2000/svg"
                                    width={32}
                                    height={32}
                                    viewBox="0 0 16 16"
                                >
                                    <g fill="currentColor">
                                        <path d="M.329 10.333A8.01 8.01 0 0 0 7.99 16C12.414 16 16 12.418 16 8s-3.586-8-8.009-8A8.006 8.006 0 0 0 0 7.468l.003.006l4.304 1.769A2.2 2.2 0 0 1 5.62 8.88l1.96-2.844l-.001-.04a3.046 3.046 0 0 1 3.042-3.043a3.046 3.046 0 0 1 3.042 3.043a3.047 3.047 0 0 1-3.111 3.044l-2.804 2a2.223 2.223 0 0 1-3.075 2.11a2.22 2.22 0 0 1-1.312-1.568L.33 10.333Z" />
                                        <path d="M4.868 12.683a1.715 1.715 0 0 0 1.318-3.165a1.7 1.7 0 0 0-1.263-.02l1.023.424a1.261 1.261 0 1 1-.97 2.33l-.99-.41a1.7 1.7 0 0 0 .882.84Zm3.726-6.687a2.03 2.03 0 0 0 2.027 2.029a2.03 2.03 0 0 0 2.027-2.029a2.03 2.03 0 0 0-2.027-2.027a2.03 2.03 0 0 0-2.027 2.027m2.03-1.527a1.524 1.524 0 1 1-.002 3.048a1.524 1.524 0 0 1 .002-3.048" />
                                    </g>
                                </ButtonIcon>
                                <ButtonText>
                                    Continue with Steam
                                </ButtonText>
                            </Button>
                            <Divider>
                                <DividerText>Or link</DividerText>
                            </Divider>
                            <Button comingSoon>
                                <ButtonText>
                                    GOG.com
                                    <Soon>Soon</Soon>
                                </ButtonText>
                                <ButtonIcon preserveAspectRatio="xMidYMax meet" viewBox="0 0 34 31" width="24" height="24">
                                    <path fill="currentColor" d="M31,31H3a3,3,0,0,1-3-3V3A3,3,0,0,1,3,0H31a3,3,0,0,1,3,3V28A3,3,0,0,1,31,31ZM4,24.5A1.5,1.5,0,0,0,5.5,26H11V24H6.5a.5.5,0,0,1-.5-.5v-3a.5.5,0,0,1,.5-.5H11V18H5.5A1.5,1.5,0,0,0,4,19.5Zm8-18A1.5,1.5,0,0,0,10.5,5h-5A1.5,1.5,0,0,0,4,6.5v5A1.5,1.5,0,0,0,5.5,13H9V11H6.5a.5.5,0,0,1-.5-.5v-3A.5.5,0,0,1,6.5,7h3a.5.5,0,0,1,.5.5v6a.5.5,0,0,1-.5.5H4v2h6.5A1.5,1.5,0,0,0,12,14.5Zm0,13v5A1.5,1.5,0,0,0,13.5,26h5A1.5,1.5,0,0,0,20,24.5v-5A1.5,1.5,0,0,0,18.5,18h-5A1.5,1.5,0,0,0,12,19.5Zm9-13A1.5,1.5,0,0,0,19.5,5h-5A1.5,1.5,0,0,0,13,6.5v5A1.5,1.5,0,0,0,14.5,13h5A1.5,1.5,0,0,0,21,11.5Zm9,0A1.5,1.5,0,0,0,28.5,5h-5A1.5,1.5,0,0,0,22,6.5v5A1.5,1.5,0,0,0,23.5,13H27V11H24.5a.5.5,0,0,1-.5-.5v-3a.5.5,0,0,1,.5-.5h3a.5.5,0,0,1,.5.5v6a.5.5,0,0,1-.5.5H22v2h6.5A1.5,1.5,0,0,0,30,14.5ZM30,18H22.5A1.5,1.5,0,0,0,21,19.5V26h2V20.5a.5.5,0,0,1,.5-.5h1v6h2V20H28v6h2ZM18.5,11h-3a.5.5,0,0,1-.5-.5v-3a.5.5,0,0,1,.5-.5h3a.5.5,0,0,1,.5.5v3A.5.5,0,0,1,18.5,11Zm-4,9h3a.5.5,0,0,1,.5.5v3a.5.5,0,0,1-.5.5h-3a.5.5,0,0,1-.5-.5v-3A.5.5,0,0,1,14.5,20Z" />
                                </ButtonIcon>
                            </Button>
                            <Button comingSoon>
                                <ButtonText>
                                    Epic Games
                                    <Soon>Soon</Soon>
                                </ButtonText>
                                <ButtonIcon xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" >
                                    <path fill="currentColor" d="M3.537 0C2.165 0 1.66.506 1.66 1.879V18.44a4 4 0 0 0 .02.433c.031.3.037.59.316.92c.027.033.311.245.311.245c.153.075.258.13.43.2l8.335 3.491c.433.199.614.276.928.27h.002c.314.006.495-.071.928-.27l8.335-3.492c.172-.07.277-.124.43-.2c0 0 .284-.211.311-.243c.28-.33.285-.621.316-.92a4 4 0 0 0 .02-.434V1.879c0-1.373-.506-1.88-1.878-1.88zm13.366 3.11h.68c1.138 0 1.688.553 1.688 1.696v1.88h-1.374v-1.8c0-.369-.17-.54-.523-.54h-.235c-.367 0-.537.17-.537.539v5.81c0 .369.17.54.537.54h.262c.353 0 .523-.171.523-.54V8.619h1.373v2.143c0 1.144-.562 1.71-1.7 1.71h-.694c-1.138 0-1.7-.566-1.7-1.71V4.82c0-1.144.562-1.709 1.7-1.709zm-12.186.08h3.114v1.274H6.117v2.603h1.648v1.275H6.117v2.774h1.74v1.275h-3.14zm3.816 0h2.198c1.138 0 1.7.564 1.7 1.708v2.445c0 1.144-.562 1.71-1.7 1.71h-.799v3.338h-1.4zm4.53 0h1.4v9.201h-1.4zm-3.13 1.235v3.392h.575c.354 0 .523-.171.523-.54V4.965c0-.368-.17-.54-.523-.54zm-3.74 10.147a1.7 1.7 0 0 1 .591.108a1.8 1.8 0 0 1 .49.299l-.452.546a1.3 1.3 0 0 0-.308-.195a.9.9 0 0 0-.363-.068a.7.7 0 0 0-.28.06a.7.7 0 0 0-.224.163a.8.8 0 0 0-.151.243a.8.8 0 0 0-.056.299v.008a.9.9 0 0 0 .056.31a.7.7 0 0 0 .157.245a.7.7 0 0 0 .238.16a.8.8 0 0 0 .303.058a.8.8 0 0 0 .445-.116v-.339h-.548v-.565H7.37v1.255a2 2 0 0 1-.524.307a1.8 1.8 0 0 1-.683.123a1.6 1.6 0 0 1-.602-.107a1.5 1.5 0 0 1-.478-.3a1.4 1.4 0 0 1-.318-.455a1.4 1.4 0 0 1-.115-.58v-.008a1.4 1.4 0 0 1 .113-.57a1.5 1.5 0 0 1 .312-.46a1.4 1.4 0 0 1 .474-.309a1.6 1.6 0 0 1 .598-.111h.045zm11.963.008a2 2 0 0 1 .612.094a1.6 1.6 0 0 1 .507.277l-.386.546a1.6 1.6 0 0 0-.39-.205a1.2 1.2 0 0 0-.388-.07a.35.35 0 0 0-.208.052a.15.15 0 0 0-.07.127v.008a.16.16 0 0 0 .022.084a.2.2 0 0 0 .076.066a1 1 0 0 0 .147.06q.093.03.236.061a3 3 0 0 1 .43.122a1.3 1.3 0 0 1 .328.17a.7.7 0 0 1 .207.24a.74.74 0 0 1 .071.337v.008a.9.9 0 0 1-.081.382a.8.8 0 0 1-.229.285a1 1 0 0 1-.353.18a1.6 1.6 0 0 1-.46.061a2.2 2.2 0 0 1-.71-.116a1.7 1.7 0 0 1-.593-.346l.43-.514q.416.335.9.335a.46.46 0 0 0 .236-.05a.16.16 0 0 0 .082-.142v-.008a.15.15 0 0 0-.02-.077a.2.2 0 0 0-.073-.066a1 1 0 0 0-.143-.062a3 3 0 0 0-.233-.062a5 5 0 0 1-.413-.113a1.3 1.3 0 0 1-.331-.16a.7.7 0 0 1-.222-.243a.73.73 0 0 1-.082-.36v-.008a.9.9 0 0 1 .074-.359a.8.8 0 0 1 .214-.283a1 1 0 0 1 .34-.185a1.4 1.4 0 0 1 .448-.066zm-9.358.025h.742l1.183 2.81h-.825l-.203-.499H8.623l-.198.498h-.81zm2.197.02h.814l.663 1.08l.663-1.08h.814v2.79h-.766v-1.602l-.711 1.091h-.016l-.707-1.083v1.593h-.754zm3.469 0h2.235v.658h-1.473v.422h1.334v.61h-1.334v.442h1.493v.658h-2.255zm-5.3.897l-.315.793h.624zm-1.145 5.19h8.014l-4.09 1.348z" />
                                </ButtonIcon>
                            </Button>
                            <Button comingSoon>
                                <ButtonText>
                                    Amazon Games
                                    <Soon>Soon</Soon>
                                </ButtonText>
                                <ButtonIcon xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 291.29 134.46" fill="currentColor">
                                    <path fill-rule="evenodd" d="M50.38,59.78c1.09-3.68,1-8.31,1-13.08V12.56c0-1.64.4-6.32-.25-7.29s-3.15-.75-4.9-.75c-5,0-7.22-.69-7.67,4.08l-.19.13c-3.92-3-7.65-5.85-14.84-5.72l-2.39.19a22.76,22.76,0,0,0-4.08,1A19.69,19.69,0,0,0,6.31,15a36.62,36.62,0,0,0-2.08,7.36,23.87,23.87,0,0,0-.38,7.54c.38,2.36.15,4.42.63,6.48,1.74,7.39,5.21,13.15,11.57,15.9a20.21,20.21,0,0,0,11.13,1.39A21,21,0,0,0,34.35,51l2.7-2h.06A22.54,22.54,0,0,1,37,55.75c-1.12,6.39-3,8.54-9.37,9.68a18,18,0,0,1-5.41.13l-5.28-.69L9.2,63a1.69,1.69,0,0,0-1.26,1.07,40.2,40.2,0,0,0,.25,7.8c.89,1.48,3.75,2.07,5.54,2.64,6,1.91,15.69,2.83,22.19.57C43.36,72.52,48.07,67.51,50.38,59.78ZM37.17,22.87V40.41a15.23,15.23,0,0,1-4.33,2.14c-10.59,3.32-14.59-4.12-14.59-13.89a25.33,25.33,0,0,1,1.13-8.87c.93-2.4,2.37-4.5,4.72-5.47.84-.34,1.85-.26,2.76-.63a21.18,21.18,0,0,1,7.8,1.2L37,16C37.57,17,37.17,21.31,37.17,22.87ZM79.74,56.32a25.65,25.65,0,0,0,8.36-3.21l3.33-2.45c.86,1.11.52,2.8,1.63,3.65s9.68,1.16,10.5,0,.44-3.67.44-5.41V26.46c0-4.37.33-9.26-.69-12.7C100.92,5.67,94.08,2.89,83.51,3l-5.66.37a62,62,0,0,0-9.56,2.08c-1.36.47-3.44.82-4,2.07s-.45,7.84.31,8.36c1.12.77,6.5-1,8-1.32,4.34-.94,14.24-1.9,16.66,1.2C91,18,90.71,22.37,90.67,26.39c-1,.24-2.72-.42-3.77-.63l-4.78-.5a18,18,0,0,0-5.28.19c-8.2,1.41-14,4.53-15.9,12.13C58,49.27,68.13,58.77,79.74,56.32ZM77.35,34.63c1.19-.7,2.67-.51,4.15-1.07,3.35,0,6.18.51,9,.63.51,1.12.14,6.83.12,8.55-2.39,3.17-12,6.33-15.27,1.82C73,41.23,74.57,36.26,77.35,34.63Zm38.53,16c0,1.75-.21,3.48.88,4.15.62.37,2.09.19,3,.19,2.09,0,9.28.44,10.06-.57,1-1.25.44-7.82.44-10.12V16.84a19.35,19.35,0,0,1,6.1-2.27c3.38-.79,7.86-.8,9.55,1.45,1.49,2,1.26,5.56,1.26,9.05v19c0,2.58-.58,9.79.88,10.69.9.54,5,.19,6.41.19s5.54.34,6.42-.32c1.18-.89.69-7.28.69-9.56q0-14.13.06-28.29c.48-.79,2.45-1.11,3.4-1.44,4.14-1.46,10.62-2.42,12.63,1.63,1,2.1.69,5.92.69,9V44.81c0,2.24-.5,8.33.44,9.56.55.71,1.83.57,3.08.57,1.88,0,9.33.33,10.19-.32,1.24-.94.75-4.74.75-6.85V28.22c0-8.24.64-15.75-3-20.44-6.52-8.5-23.71-3.95-30,1.45h-.25C157.15,5.18,153,2.9,146.44,3l-2.64.19a30.21,30.21,0,0,0-5.28,1.19,40.58,40.58,0,0,0-6.35,3l-3.08,1.89c-1.12-1.35-.44-3.54-2-4.46-.61-.37-8.67-.47-9.8-.19a2,2,0,0,0-1.07.69c-.66,1-.32,7.59-.32,9.49Zm96.32,2.13c6.17,3.87,17.31,4.71,26.09,2.52,2.21-.55,6.52-1.33,7.29-3.14a48.27,48.27,0,0,0,.12-7.55,1.83,1.83,0,0,0-.81-.94c-.79-.34-2,.24-2.77.44l-6.48,1.19a23.66,23.66,0,0,1-7.16.26,39.37,39.37,0,0,1-5-.7c-4.92-1.49-8.19-5.16-8.24-11.44,1.17-.53,5-.12,6.6-.12h16c2.3,0,6,.47,7.41-.57,1.89-1.41,1.75-10.85,1.14-13.89-2.07-10.3-8.28-16-20.75-15.78l-1.51.06-4.53.63c-4.86,1.22-9.05,3.46-11.75,6.85a25.69,25.69,0,0,0-3.71,6C201.68,22.42,201,33,203.08,40,204.76,45.59,207.71,49.93,212.2,52.73Zm3.7-32.56c1.13-3.25,3-5.62,6.29-6.66L225,13c7.46-.07,9.52,3.79,9.43,11.26-1,.46-4.25.12-5.66.12H215.21C214.8,23.33,215.58,21.1,215.9,20.17Zm77.65,13.2c-3-5.2-9.52-7.23-15.34-9.62-2.76-1.13-7.28-2.08-7.93-5.28-1.37-6.84,12.69-4.86,16.85-3.83,1.16.28,3.85,1.33,4.59.37s.38-3.29.38-4.77c0-1.23.16-2.8-.32-3.59-.72-1.21-2.61-1.55-4.08-2A36.6,36.6,0,0,0,276,3l-3.59.25A29.08,29.08,0,0,0,265.88,5a14.84,14.84,0,0,0-8,7.79c-2.23,5.52-.14,12.84,3.21,15.53,4,3.23,9.43,5.07,14.58,7.17,2.6,1.06,5.55,1.67,6.1,4.78,1.49,8.45-14.51,5.39-19.3,4.15-1-.27-4.16-1.34-5-.88-1.14.65-.69,3.85-.69,5.59,0,1-.15,2.42.25,3.08,1.2,2,7.83,3.26,10.75,3.84,11.6,2.3,21.92-1.62,25.65-8.93C295.3,43.59,295.64,37,293.55,33.37ZM252.81,83l-2.2.13a37.54,37.54,0,0,0-6.35.69,43.91,43.91,0,0,0-13.52,4.72c-1,.61-5,2.58-4.27,4.4.57,1.46,6.36.25,8.23.12,3.7-.25,5.51-.57,9-.56h6.41a35.9,35.9,0,0,1,5.73.37,8.52,8.52,0,0,1,3.45,1.64c1.46,1.25,1.19,5.49.69,7.48a139.33,139.33,0,0,1-5.78,18.86c-.41,1-3.64,7.3-.06,6.54,1.62-.35,4.9-4,5.91-5.22,5-6.39,8.15-13.75,10.5-23,.54-2.15,1.78-10.6.56-12.57C269.11,83.34,258.52,82.89,252.81,83ZM245,101l-5.72,2.51-9.49,3.58c-8.44,3.27-17.84,5.41-27.23,7.74l-11,2.07-12.95,1.7-4.15.31c-1.66.35-3.61.15-5.47.44a83.4,83.4,0,0,1-12.38.51l-9.37.06-6.73-.25-4.33-.25c-1-.2-2.18-.06-3.27-.26l-13.14-1.44c-3.89-.73-8.07-1-11.76-2l-3.08-.51L93.5,112.65c-8.16-2.55-16.27-4.54-23.89-7.48-8.46-3.27-17.29-6.84-24.77-11.26l-7.41-4.27c-1.35-.81-2.44-2-4.59-2-1.6.79-2.09,1.83-1,3.71a12.73,12.73,0,0,0,2.89,2.83l3.4,3.14c4.9,3.9,9.82,7.91,15.15,11.38,4.6,3,9.5,5.55,14.33,8.36l7.23,3.46c4.13,1.82,8.42,3.7,12.76,5.4l11.13,3.71c6,2,12.53,3,19,4.59l13.64,2,4.4.32,7.42.56h2.7a30.39,30.39,0,0,0,7.92.07l2.83-.07,3.46-.06,11.82-.94c5.3-1.18,10.88-1,15.9-2.52l11.57-2.82a195.36,195.36,0,0,0,20.31-7.11,144.13,144.13,0,0,0,23.63-12.57c2.56-1.72,6.18-3,6.86-6.6C250.75,101.43,247.63,100.27,245,101Z" transform="translate(-3.69 -3)" />
                                </ButtonIcon>
                            </Button>
                        </ButtonContainer>
                        <Footer>
                            <Link target="_blank" href="https://discord.gg/6um5K6jrYj" >Help I can't connect my account</Link>
                        </Footer>
                    </Card>
                </CardWrapper>
            </Container>
            <LogoFooter >
                <Logo viewBox="0 0 498.05 70.508" xmlns="http://www.w3.org/2000/svg" height={157} width={695} >
                    <g stroke-linecap="round" fill-rule="evenodd" font-size="9pt" stroke="currentColor" stroke-width="0.25mm" fill="currentColor" style="stroke:currentColor;stroke-width:0.25mm;fill:currentColor">
                        <path
                            fill="url(#paint1)"
                            pathLength="1"
                            stroke="url(#paint1)"
                            d="M 261.23 41.65 L 212.402 41.65 Q 195.313 41.65 195.313 27.002 L 195.313 14.795 A 17.814 17.814 0 0 1 196.311 8.57 Q 199.443 0.146 212.402 0.146 L 283.203 0.146 L 283.203 14.844 L 217.236 14.844 Q 215.337 14.844 214.945 16.383 A 3.67 3.67 0 0 0 214.844 17.285 L 214.844 24.561 Q 214.844 27.002 217.236 27.002 L 266.113 27.002 Q 283.203 27.002 283.203 41.65 L 283.203 53.857 A 17.814 17.814 0 0 1 282.205 60.083 Q 279.073 68.506 266.113 68.506 L 195.313 68.506 L 195.313 53.809 L 261.23 53.809 A 3.515 3.515 0 0 0 262.197 53.688 Q 263.672 53.265 263.672 51.367 L 263.672 44.092 A 3.515 3.515 0 0 0 263.551 43.126 Q 263.128 41.65 261.23 41.65 Z M 185.547 53.906 L 185.547 68.506 L 114.746 68.506 Q 97.656 68.506 97.656 53.857 L 97.656 14.795 A 17.814 17.814 0 0 1 98.655 8.57 Q 101.787 0.146 114.746 0.146 L 168.457 0.146 Q 185.547 0.146 185.547 14.795 L 185.547 31.885 A 17.827 17.827 0 0 1 184.544 38.124 Q 181.621 45.972 170.174 46.538 A 36.906 36.906 0 0 1 168.457 46.582 L 117.188 46.582 L 117.236 51.465 Q 117.236 53.906 119.629 53.955 L 185.547 53.906 Z M 19.531 14.795 L 19.531 68.506 L 0 68.506 L 0 0.146 L 70.801 0.146 Q 87.891 0.146 87.891 14.795 L 87.891 68.506 L 68.359 68.506 L 68.359 17.236 Q 68.359 14.795 65.967 14.795 L 19.531 14.795 Z M 449.219 68.506 L 430.176 46.533 L 400.391 46.533 L 400.391 68.506 L 380.859 68.506 L 380.859 0.146 L 451.66 0.146 A 24.602 24.602 0 0 1 458.423 0.994 Q 466.007 3.166 468.021 10.907 A 25.178 25.178 0 0 1 468.75 17.236 L 468.75 31.885 A 18.217 18.217 0 0 1 467.887 37.73 Q 465.954 43.444 459.698 45.455 A 23.245 23.245 0 0 1 454.492 46.436 L 473.633 68.506 L 449.219 68.506 Z M 292.969 0 L 371.094 0.098 L 371.094 14.795 L 341.846 14.795 L 341.846 68.506 L 322.266 68.506 L 322.217 14.795 L 292.969 14.844 L 292.969 0 Z M 478.516 0.146 L 498.047 0.146 L 498.047 68.506 L 478.516 68.506 L 478.516 0.146 Z M 400.391 14.844 L 400.391 31.885 L 446.826 31.885 Q 448.726 31.885 449.117 30.345 A 3.67 3.67 0 0 0 449.219 29.443 L 449.219 17.285 Q 449.219 14.844 446.826 14.844 L 400.391 14.844 Z M 117.188 31.836 L 163.574 31.934 Q 165.528 31.895 165.918 30.355 A 3.514 3.514 0 0 0 166.016 29.492 L 166.016 17.236 Q 166.016 15.337 164.476 14.945 A 3.67 3.67 0 0 0 163.574 14.844 L 119.629 14.795 Q 117.188 14.795 117.188 17.188 L 117.188 31.836 Z" />
                    </g>
                    <defs>
                        <linearGradient gradientUnits="userSpaceOnUse" id="paint1" x1="317.5" x2="314.007" y1="-51.5" y2="126">
                            <stop stop-color="white"></stop>
                            <stop offset="1" stop-opacity="0"></stop>
                        </linearGradient>
                    </defs>
                </Logo>
            </LogoFooter>
        </FullScreen>
    )
}