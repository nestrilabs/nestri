import { styled } from "@macaron-css/solid";
import { Header } from "@nestri/www/pages/team/header";
import { useSteam } from "@nestri/www/providers/steam";
import { theme } from "@nestri/www/ui";
import { FullScreen } from "@nestri/www/ui/layout";
import { createEffect, onCleanup } from "solid-js";

const OnboardingSection = styled("section", {
    base: {
        maxWidth: 640,
        paddingLeft: "2rem",
        paddingRight: "2rem",
        marginLeft: "auto",
        marginRight: "auto",
    }
})

const Root = styled("div", {
    base: {
        padding: theme.space[4],
        backgroundColor: theme.color.background.d200,
    },
});

const Stepper = styled("div", {
    base: {
        // marginTop: 16,
        width: 408,
        marginBottom: 8,
        display: "flex",
        flexDirection: "row",
    }
})

const Step = styled("div", {
    base: {
        display: "flex",
        flex: "1 0 100px",
        flexDirection: "column"
    }
})

const StepLabel = styled("span", {
    base: {
        flex: "1 0 16px",
        lineHeight: "16px",
        marginBottom: 9,
        letterSpacing: .1,
        textAlign: "center",
        fontSize: theme.font.size.xs,
        color: theme.color.grayAlpha.d900,
        fontWeight: theme.font.weight.medium,
        selectors: {
            [`${Step}[data-state="active"] &`]: {
                color: theme.color.d1000.grayAlpha,
            },
            [`${Step}[data-state="completed"] &`]: {
                color: theme.color.d1000.grayAlpha,
            }
        }
    }
})

const StepTimeline = styled("div", {
    base: {
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
    }
})

const StepLeftTrack = styled("div", {
    base: {
        backgroundColor: theme.color.grayAlpha.d400,
        height: 4,
        flex: "1 1 10px",
        selectors: {
            [`${Step}:first-child &`]: {
                visibility: "hidden"
            },
            [`${Step}[data-state="active"] &`]: {
                backgroundColor: theme.color.brand,
            },
            [`${Step}[data-state="completed"] &`]: {
                backgroundColor: theme.color.brand,
            },
        }
    }
})

const StepRightTrack = styled("div", {
    base: {
        height: 4,
        flex: "1 1 10px",
        backgroundColor: theme.color.grayAlpha.d400,
        selectors: {
            [`${Step}:last-child &`]: {
                visibility: "hidden"
            },
            [`${Step}[data-state="completed"] &`]: {
                backgroundColor: theme.color.brand
            }
        }
    }
})

const StepDot = styled("div", {
    base: {
        borderRadius: 10,
        width: 20,
        height: 20,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "0 0 20px",
        border: `4px solid ${theme.color.grayAlpha.d400}`,
        selectors: {
            [`${Step}[data-state="active"] &`]: {
                borderColor: theme.color.brand
            },
            [`${Step}[data-state="completed"] &`]: {
                borderColor: theme.color.brand
            }
        }
    }
})

const HorizontalStepper = styled("div", {
    base: {
        counterReset: "step",
    }
})

const HorizontalStep = styled("div", {
    base: {
        borderWidth: 0,
        borderLeft: 4,
        position: "relative",
        borderStyle: "solid",
        borderColor: theme.color.gray.d400,
        paddingLeft: 20,
        marginLeft: 10,
        paddingBottom: 64
    }
})

const HorizontalStepDot = styled("div", {
    base: {
        position: "absolute",
        top: -2,
        left: -2,
        height: 10,
    }
})

const StepDotChild = styled("div", {
    base: {
        borderRadius: 10,
        width: 20,
        height: 20,
        border: `4px solid ${theme.color.grayAlpha.d400}`,
        position: "absolute",
        left: "50%",
        top: "50%",
        transform: "translate(-50%,-50%)",
    }
})
export function HomeRoute() {

    const steam = useSteam();

    // Connect to the login stream when component mounts
    createEffect(() => {
        steam.client.loginStream.connect();

        // Clean up on component unmount
        onCleanup(() => {
            steam.client.loginStream.disconnect();
        });
    });
    return (
        <>
            <Header />
            <Root>
                <OnboardingSection>
                    {/* <Stepper>
                        <Step data-state="completed" >
                            <StepLabel>
                                Steam
                            </StepLabel>
                            <StepTimeline>
                                <StepLeftTrack />
                                <StepDot></StepDot>
                                <StepRightTrack />
                            </StepTimeline>
                        </Step>
                        <Step data-state="completed">
                            <StepLabel>
                                Machine
                            </StepLabel>
                            <StepTimeline>
                                <StepLeftTrack />
                                <StepDot></StepDot>
                                <StepRightTrack />
                            </StepTimeline>
                        </Step>
                        <Step data-state="active">
                            <StepLabel>
                                Games
                            </StepLabel>
                            <StepTimeline>
                                <StepLeftTrack />
                                <StepDot></StepDot>
                                <StepRightTrack />
                            </StepTimeline>
                        </Step>
                    </Stepper> */}
                    {/* <HorizontalStepper>
                        <HorizontalStep>
                            <HorizontalStepDot>
                                <StepDotChild>

                                </StepDotChild>
                            </HorizontalStepDot>
                        </HorizontalStep>
                    </HorizontalStepper> */}
                    <div class="connection-status">
                        Status: {steam.client.loginStream.isConnected() ? "Connected" : "Connecting..."}
                    </div>

                    <div class="qr-container">
                        {/* <img
                            src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent( || '')}`}
                            alt="Steam Login QR Code"
                            width="200"
                            height="200"
                        /> */}
                        URL: {steam.client.loginStream.loginUrl()}
                    </div>
                </OnboardingSection>
            </Root>
        </>
    )
}