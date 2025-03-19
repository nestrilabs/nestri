import { styled } from "@macaron-css/solid";
import { Header } from "@nestri/www/pages/team/header";
import { theme } from "@nestri/www/ui";
import { FullScreen } from "@nestri/www/ui/layout";

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
        height: 408,
        marginBottom: 8,
        display: "flex",
        flexDirection: "column",
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
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
    }
})

const StepLeftTrack = styled("div", {
    base: {
        backgroundColor: theme.color.grayAlpha.d400,
        width: 4,
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
        width: 4,
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
export function HomeRoute() {
    return (
        <>
            <Header />
            <Root>
                <OnboardingSection>
                    <Stepper>
                        <Step data-state="active" >
                            {/* <StepLabel>
                                Steam
                            </StepLabel> */}
                            <StepTimeline>
                                <StepLeftTrack />
                                <StepDot></StepDot>
                                <StepRightTrack />
                            </StepTimeline>
                        </Step>
                        <Step>
                            {/* <StepLabel>
                                Machine
                            </StepLabel> */}
                            <StepTimeline>
                                <StepLeftTrack />
                                <StepDot></StepDot>
                                <StepRightTrack />
                            </StepTimeline>
                        </Step>
                        <Step>
                            {/* <StepLabel>
                                Games
                            </StepLabel> */}
                            <StepTimeline>
                                <StepLeftTrack />
                                <StepDot></StepDot>
                                <StepRightTrack />
                            </StepTimeline>
                        </Step>
                    </Stepper>
                </OnboardingSection>
            </Root>
        </>
    )
}