import { styled } from "@macaron-css/solid";
import { useTeam } from "@nestri/www/providers/context";
import { Container } from "@nestri/www/ui";
import Avatar from "@nestri/www/ui/avatar";
import { theme } from "@nestri/www/ui/theme";
import { A } from "@solidjs/router";
import { Match, Show, Switch } from "solid-js";

const Root = styled("div", {
    base: {
        top: "0",
        zIndex: 10,
        position: "sticky",
        display: "flex",
        alignItems: "center",
        backdropFilter: "blur(8px)",
        padding: `0 ${theme.space[4]}`,
        justifyContent: "space-between",
        height: theme.headerHeight.root,
        WebkitBackdropFilter: "blur(8px)",
        backgroundColor: theme.color.background.d100,
        borderBottom: `1px solid ${theme.color.grayAlpha.d100}`,
    },
});

const NestriLogo = styled("svg", {
    base: {
        height: 28,
        width: 28,
    }
})

const NestriLogoBig = styled("svg", {
    base: {
        height: 38,
        width: 38,
    }
})

const LineSvg = styled("svg", {
    base: {
        width: 26,
        height: 26,
        color: theme.color.grayAlpha.d300
    }
})

const LogoName = styled("svg", {
    base: {
        height: 15,
        color: theme.color.d1000.grayAlpha
    }
})

const Link = styled(A, {
    base: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 2
    }
})

const TeamRoot = styled("div", {
    base: {
        height: 32,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8
    }
})

const LogoRoot = styled("div", {
    base: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
    }
})

const TeamLabel = styled("span", {
    base: {
        letterSpacing: -0.5,
        fontSize: theme.font.size.base,
        fontFamily: theme.font.family.heading,
        fontWeight: theme.font.weight.semibold,
    }
})

const Badge = styled("div", {
    base: {
        height: 20,
        fontSize: 11,
        lineHeight: 1,
        color: "#FFF",
        padding: "0 6px",
        letterSpacing: 0.2,
        borderRadius: 9999,
        alignItems: "center",
        display: "inline-flex",
        whiteSpace: "pre-wrap",
        justifyContent: "center",
        fontFeatureSettings: `"tnum"`,
        fontVariantNumeric: "tabular-nums",
    }
})

const DropIcon = styled("svg", {
    base: {
        height: 14,
        width: 14,
        marginLeft: -4,
        color: theme.color.grayAlpha.d800
    }
})

export function Header() {
    const team = useTeam()
    return (
        <Root>
            <Container space="4" vertical="center">
                <Show when={team}
                    fallback={
                        <Link href="/">
                            <NestriLogoBig
                                width="100%"
                                height="100%"
                                viewBox="0 0 12.8778 9.7377253"
                                version="1.1"
                                id="svg1"
                                xmlns="http://www.w3.org/2000/svg">
                                <path
                                    d="m 2.093439,1.7855532 h 8.690922 V 2.2639978 H 2.093439 Z m 0,2.8440874 h 8.690922 V 5.1080848 H 2.093439 Z m 0,2.8440866 h 8.690922 V 7.952172 H 2.093439 Z"
                                    style="font-size:12px;fill:#ff4f01;fill-opacity:1;fill-rule:evenodd;stroke:#ff4f01;stroke-width:1.66201;stroke-linecap:round;stroke-dasharray:none;stroke-opacity:1" />
                            </NestriLogoBig>
                            <LogoName viewBox="0 0 498.05 70.508" xmlns="http://www.w3.org/2000/svg" height="100%" width="100%" >
                                <g stroke-line-cap="round" fill-rule="evenodd" font-size="9pt" fill="currentColor">
                                    <path
                                        fill="currentColor"
                                        pathLength="1"
                                        // stroke="url(#paint1)"
                                        d="M 261.23 41.65 L 212.402 41.65 Q 195.313 41.65 195.313 27.002 L 195.313 14.795 A 17.814 17.814 0 0 1 196.311 8.57 Q 199.443 0.146 212.402 0.146 L 283.203 0.146 L 283.203 14.844 L 217.236 14.844 Q 215.337 14.844 214.945 16.383 A 3.67 3.67 0 0 0 214.844 17.285 L 214.844 24.561 Q 214.844 27.002 217.236 27.002 L 266.113 27.002 Q 283.203 27.002 283.203 41.65 L 283.203 53.857 A 17.814 17.814 0 0 1 282.205 60.083 Q 279.073 68.506 266.113 68.506 L 195.313 68.506 L 195.313 53.809 L 261.23 53.809 A 3.515 3.515 0 0 0 262.197 53.688 Q 263.672 53.265 263.672 51.367 L 263.672 44.092 A 3.515 3.515 0 0 0 263.551 43.126 Q 263.128 41.65 261.23 41.65 Z M 185.547 53.906 L 185.547 68.506 L 114.746 68.506 Q 97.656 68.506 97.656 53.857 L 97.656 14.795 A 17.814 17.814 0 0 1 98.655 8.57 Q 101.787 0.146 114.746 0.146 L 168.457 0.146 Q 185.547 0.146 185.547 14.795 L 185.547 31.885 A 17.827 17.827 0 0 1 184.544 38.124 Q 181.621 45.972 170.174 46.538 A 36.906 36.906 0 0 1 168.457 46.582 L 117.188 46.582 L 117.236 51.465 Q 117.236 53.906 119.629 53.955 L 185.547 53.906 Z M 19.531 14.795 L 19.531 68.506 L 0 68.506 L 0 0.146 L 70.801 0.146 Q 87.891 0.146 87.891 14.795 L 87.891 68.506 L 68.359 68.506 L 68.359 17.236 Q 68.359 14.795 65.967 14.795 L 19.531 14.795 Z M 449.219 68.506 L 430.176 46.533 L 400.391 46.533 L 400.391 68.506 L 380.859 68.506 L 380.859 0.146 L 451.66 0.146 A 24.602 24.602 0 0 1 458.423 0.994 Q 466.007 3.166 468.021 10.907 A 25.178 25.178 0 0 1 468.75 17.236 L 468.75 31.885 A 18.217 18.217 0 0 1 467.887 37.73 Q 465.954 43.444 459.698 45.455 A 23.245 23.245 0 0 1 454.492 46.436 L 473.633 68.506 L 449.219 68.506 Z M 292.969 0 L 371.094 0.098 L 371.094 14.795 L 341.846 14.795 L 341.846 68.506 L 322.266 68.506 L 322.217 14.795 L 292.969 14.844 L 292.969 0 Z M 478.516 0.146 L 498.047 0.146 L 498.047 68.506 L 478.516 68.506 L 478.516 0.146 Z M 400.391 14.844 L 400.391 31.885 L 446.826 31.885 Q 448.726 31.885 449.117 30.345 A 3.67 3.67 0 0 0 449.219 29.443 L 449.219 17.285 Q 449.219 14.844 446.826 14.844 L 400.391 14.844 Z M 117.188 31.836 L 163.574 31.934 Q 165.528 31.895 165.918 30.355 A 3.514 3.514 0 0 0 166.016 29.492 L 166.016 17.236 Q 166.016 15.337 164.476 14.945 A 3.67 3.67 0 0 0 163.574 14.844 L 119.629 14.795 Q 117.188 14.795 117.188 17.188 L 117.188 31.836 Z" />
                                </g>
                            </LogoName>
                        </Link>
                    }
                >
                    {/* <Link href="/">
                        <NestriLogoBig
                            width="100%"
                            height="100%"
                            viewBox="0 0 12.8778 9.7377253"
                            version="1.1"
                            id="svg1"
                            xmlns="http://www.w3.org/2000/svg">
                            <path
                                d="m 2.093439,1.7855532 h 8.690922 V 2.2639978 H 2.093439 Z m 0,2.8440874 h 8.690922 V 5.1080848 H 2.093439 Z m 0,2.8440866 h 8.690922 V 7.952172 H 2.093439 Z"
                                style="font-size:12px;fill:#ff4f01;fill-opacity:1;fill-rule:evenodd;stroke:#ff4f01;stroke-width:1.66201;stroke-linecap:round;stroke-dasharray:none;stroke-opacity:1" />
                        </NestriLogoBig>
                        <LogoName viewBox="0 0 498.05 70.508" xmlns="http://www.w3.org/2000/svg" height="100%" width="100%" >
                            <g stroke-line-cap="round" fill-rule="evenodd" font-size="9pt" fill="currentColor">
                                <path
                                    fill="currentColor"
                                    pathLength="1"
                                    d="M 261.23 41.65 L 212.402 41.65 Q 195.313 41.65 195.313 27.002 L 195.313 14.795 A 17.814 17.814 0 0 1 196.311 8.57 Q 199.443 0.146 212.402 0.146 L 283.203 0.146 L 283.203 14.844 L 217.236 14.844 Q 215.337 14.844 214.945 16.383 A 3.67 3.67 0 0 0 214.844 17.285 L 214.844 24.561 Q 214.844 27.002 217.236 27.002 L 266.113 27.002 Q 283.203 27.002 283.203 41.65 L 283.203 53.857 A 17.814 17.814 0 0 1 282.205 60.083 Q 279.073 68.506 266.113 68.506 L 195.313 68.506 L 195.313 53.809 L 261.23 53.809 A 3.515 3.515 0 0 0 262.197 53.688 Q 263.672 53.265 263.672 51.367 L 263.672 44.092 A 3.515 3.515 0 0 0 263.551 43.126 Q 263.128 41.65 261.23 41.65 Z M 185.547 53.906 L 185.547 68.506 L 114.746 68.506 Q 97.656 68.506 97.656 53.857 L 97.656 14.795 A 17.814 17.814 0 0 1 98.655 8.57 Q 101.787 0.146 114.746 0.146 L 168.457 0.146 Q 185.547 0.146 185.547 14.795 L 185.547 31.885 A 17.827 17.827 0 0 1 184.544 38.124 Q 181.621 45.972 170.174 46.538 A 36.906 36.906 0 0 1 168.457 46.582 L 117.188 46.582 L 117.236 51.465 Q 117.236 53.906 119.629 53.955 L 185.547 53.906 Z M 19.531 14.795 L 19.531 68.506 L 0 68.506 L 0 0.146 L 70.801 0.146 Q 87.891 0.146 87.891 14.795 L 87.891 68.506 L 68.359 68.506 L 68.359 17.236 Q 68.359 14.795 65.967 14.795 L 19.531 14.795 Z M 449.219 68.506 L 430.176 46.533 L 400.391 46.533 L 400.391 68.506 L 380.859 68.506 L 380.859 0.146 L 451.66 0.146 A 24.602 24.602 0 0 1 458.423 0.994 Q 466.007 3.166 468.021 10.907 A 25.178 25.178 0 0 1 468.75 17.236 L 468.75 31.885 A 18.217 18.217 0 0 1 467.887 37.73 Q 465.954 43.444 459.698 45.455 A 23.245 23.245 0 0 1 454.492 46.436 L 473.633 68.506 L 449.219 68.506 Z M 292.969 0 L 371.094 0.098 L 371.094 14.795 L 341.846 14.795 L 341.846 68.506 L 322.266 68.506 L 322.217 14.795 L 292.969 14.844 L 292.969 0 Z M 478.516 0.146 L 498.047 0.146 L 498.047 68.506 L 478.516 68.506 L 478.516 0.146 Z M 400.391 14.844 L 400.391 31.885 L 446.826 31.885 Q 448.726 31.885 449.117 30.345 A 3.67 3.67 0 0 0 449.219 29.443 L 449.219 17.285 Q 449.219 14.844 446.826 14.844 L 400.391 14.844 Z M 117.188 31.836 L 163.574 31.934 Q 165.528 31.895 165.918 30.355 A 3.514 3.514 0 0 0 166.016 29.492 L 166.016 17.236 Q 166.016 15.337 164.476 14.945 A 3.67 3.67 0 0 0 163.574 14.844 L 119.629 14.795 Q 117.188 14.795 117.188 17.188 L 117.188 31.836 Z" />
                            </g>
                        </LogoName>
                    </Link> */}
                    <LogoRoot>
                        <NestriLogo
                            width={32}
                            height={32}
                            viewBox="0 0 12.8778 9.7377253"
                            version="1.1"
                            id="svg1"
                            xmlns="http://www.w3.org/2000/svg">
                            <path
                                d="m 2.093439,1.7855532 h 8.690922 V 2.2639978 H 2.093439 Z m 0,2.8440874 h 8.690922 V 5.1080848 H 2.093439 Z m 0,2.8440866 h 8.690922 V 7.952172 H 2.093439 Z"
                                style="font-size:12px;fill:#ff4f01;fill-opacity:1;fill-rule:evenodd;stroke:#ff4f01;stroke-width:1.66201;stroke-linecap:round;stroke-dasharray:none;stroke-opacity:1" />
                        </NestriLogo>
                        <LineSvg
                            height="16"
                            stroke-linejoin="round"
                            viewBox="0 0 16 16"
                            width="16">
                            <path
                                fill-rule="evenodd"
                                clip-rule="evenodd"
                                d="M4.01526 15.3939L4.3107 14.7046L10.3107 0.704556L10.6061 0.0151978L11.9849 0.606077L11.6894 1.29544L5.68942 15.2954L5.39398 15.9848L4.01526 15.3939Z" fill="currentColor"></path>
                        </LineSvg>
                        <TeamRoot>
                            <Avatar size={21} name={team().slug} />
                            <TeamLabel>{team().name}</TeamLabel>
                            <Switch>
                                <Match when={team().planType === "BYOG"}>
                                    <Badge style={{ "background-color": theme.color.purple.d700 }}>
                                        <span style={{ "line-height": 0 }} >BYOG</span>
                                    </Badge>
                                </Match>
                                <Match when={team().planType === "Hosted"}>
                                    <Badge style={{ "background-color": theme.color.blue.d700 }}>
                                        <span style={{ "line-height": 0 }}>Hosted</span>
                                    </Badge>
                                </Match>
                            </Switch>
                            <DropIcon
                                xmlns="http://www.w3.org/2000/svg"
                                width="32"
                                height="32"
                                viewBox="0 0 256 256">
                                <path
                                    fill="currentColor"
                                    d="M72.61 83.06a8 8 0 0 1 1.73-8.72l48-48a8 8 0 0 1 11.32 0l48 48A8 8 0 0 1 176 88H80a8 8 0 0 1-7.39-4.94M176 168H80a8 8 0 0 0-5.66 13.66l48 48a8 8 0 0 0 11.32 0l48-48A8 8 0 0 0 176 168" />
                            </DropIcon>
                        </TeamRoot>
                    </LogoRoot>
                </Show>
            </Container>
        </Root >
    )
}