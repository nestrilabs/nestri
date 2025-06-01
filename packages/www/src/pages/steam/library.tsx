import { For } from "solid-js";
import { styled } from "@macaron-css/solid";
import { FullScreen, theme } from "@nestri/www/ui";
import { Header } from "@nestri/www/pages/steam/header";

const Container = styled("div", {
    base: {
        width: "100%",
        display: "flex",
        alignItems: "center",
        flexDirection: "column",
        zIndex: 10,
        isolation: "isolate",
        marginTop: 30,
    }
})

const Wrapper = styled("div", {
    base: {
        maxWidth: "70vw",
        width: "100%",
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        margin: "0 auto",
        display: "grid",
        columnGap: 12,
        rowGap: 10
    }
})


const SquareImage = styled("img", {
    base: {
        width: "100%",
        height: "100%",
        userSelect: "none",
        aspectRatio: "1/1",
        borderRadius: 10,
        transitionDuration: "0.4s",
        transitionTimingFunction: "cubic-bezier(0.4,0,0.2,1)",
        transitionProperty: "opacity",
        cursor: "pointer",
        border: `3px solid transparent`,
        ":hover": {
            // transform: "scale(1.01)",
            outline: `3px solid ${theme.color.brand}`
        }
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
        justifyContent: "flex-start",
        alignItems: "center",
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

const Title = styled("h1", {
    base: {
        lineHeight: "2.5rem",
        fontWeight: theme.font.weight.semibold,
        letterSpacing: "-0.069375rem",
        textAlign: "left",
        fontSize: theme.font.size["4xl"],
        textTransform: "capitalize"
    }
})

const Description = styled("p", {
    base: {
        fontSize: theme.font.size.sm,
        lineHeight: "1.25rem",
        textAlign: "left",
        fontWeight: theme.font.weight.regular,
        letterSpacing: "initial",
        color: theme.color.gray.d900
    }
})

const LogoFooter = styled("section", {
    base: {
        position: "relative",
        bottom: -1,
        fontSize: "100%",
        maxWidth: 1440,
        width: "100%",
        pointerEvents: "none",
        display: "flex",
        margin: "-80px 0",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 8px",
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
//MaRt@6563
export function LibraryRoute() {

    return (
        <Header>
            <FullScreen inset="header" >
                <TitleHeader>
                    <TitleWrapper>
                        <TitleContainer>
                            <Title>
                                Your Steam Library
                            </Title>
                            <Description>
                                Install games directly from your Steam account to your Nestri Machine
                            </Description>
                        </TitleContainer>
                    </TitleWrapper>
                </TitleHeader>
                <Container>
                    <Wrapper>
                        <For each={new Array(30)} >
                            {(item, index) => (
                                <SquareImage
                                    draggable={false}
                                    alt="Assasin's Creed Shadows"
                                    src={`/src/assets/games/${index() + 1}.png`} />
                            )}
                        </For>
                    </Wrapper>
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
        </Header>
    )
}