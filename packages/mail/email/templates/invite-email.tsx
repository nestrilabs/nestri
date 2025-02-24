//Sent on sign up or log in to verify the email address
import React from "react"
import {
    Body,
    Container,
    Heading,
    Hr,
    Html,
    Img,
    Link,
    Preview,
    Section,
    Tailwind,
    Text,
    Font,
    Head
} from "@jsx-email/all";

const LOCAL_ASSETS_URL = "https://nestri.io"

type InviteEmailProps = {
    name: string;
    inviteCode: string;
    login: boolean;
    assetsUrl: string;
    team: string;
    consoleUrl: string;
}

export default function VerifyEmail({
    name = "Wanjohi",
    inviteCode = "230476",
    login = true,
    assetsUrl = LOCAL_ASSETS_URL,
    team = "seed",
    consoleUrl = "https://console.nestri.io"
}: InviteEmailProps) {
    const messagePlain = `You've been invited to join the ${team} team on Nestri.`;
    const subject = `Join the ${team} team`;
    const url = `${consoleUrl}/${team}`;
    return (
        <Html lang="en" className="p-0 m-0 w-full">
            <Tailwind
                config={{
                    theme: {
                        extend: {
                            colors: {
                                text: {
                                    DEFAULT: "#0a0a0a",
                                    dark: "#fafafa",
                                    muted: "#fafafab3",
                                    mutedDark: "#0a0a0ab3",
                                },
                                bg: {
                                    DEFAULT: "#f5f5f5",
                                    dark: "#171717",
                                },
                                link: {
                                    DEFAULT: "#FF7033",
                                    dark: "#CC3D00",
                                },
                                border: {
                                    DEFAULT: "#d4d4d4",
                                    dark: "#404040",
                                }
                            },
                            fontFamily: {
                                'sans': ['Geist Sans', 'sans-serif'],
                                'title': ['Bricolage Grotesque', 'sans-serif'],
                            }
                        },
                    },
                }}
            >
                <Head>
                    <Font
                        fontFamily="Geist"
                        fallbackFontFamily="Helvetica"
                        webFont={{
                            url: "https://cdn.jsdelivr.net/npm/@fontsource/geist-sans@5.0.1/files/geist-sans-latin-400-normal.woff2",
                            format: "woff2",
                        }}
                        fontWeight={400}
                        fontStyle="normal"
                    />

                    <Font
                        fontFamily="Bricolage Grotesque"
                        fallbackFontFamily="Helvetica"
                        webFont={{
                            url: "https://cdn.jsdelivr.net/fontsource/fonts/bricolage-grotesque@latest/latin-700-normal.woff2",
                            format: "woff2",
                        }}
                        fontWeight={700}
                        fontStyle="normal"
                    />

                    <Font
                        fontFamily="Geist"
                        fallbackFontFamily="Helvetica"
                        webFont={{
                            url: "https://cdn.jsdelivr.net/npm/@fontsource/geist-sans@5.0.1/files/geist-sans-latin-500-normal.woff2",
                            format: "woff2",
                        }}
                        fontWeight={500}
                        fontStyle="normal"
                    />
                    <title>{`Nestri — ${messagePlain}`}</title>
                </Head>
                <Preview>{messagePlain}</Preview>
                <Body className="py-8 sm:px-0 px-2 bg-[#FFF] dark:bg-[#000] text-text dark:text-text-dark font-sans">
                    <Container className="max-w-[28rem] mx-auto">
                        <Link href="https://nestri.io">
                            <Img
                                width={64}
                                className="block outline-none border-none text-decoration-none h-auto"
                                src={`${assetsUrl}/logo.webp`}
                                alt="Nestri logo" />
                        </Link>
                        <Heading className="m-0 text-text dark:text-text-dark font-title font-bold mt-8 text-2xl leading-5" >{subject}</Heading>
                        {/* <Hr className="my-4" /> */}
                        <Section>
                            <Text>
                                You've been invited to join the&nbsp;
                                <Link href={url} className="!text-text dark:!text-text-dark">
                                    {team}
                                </Link>
                                &nbsp;team on the&nbsp;
                                <Link className="!text-text dark:!text-text-dark" href={consoleUrl}>
                                    Nestri Console
                                </Link>
                            </Text>
                        </Section>
                        <Hr className="my-2" />
                        <Section>
                            <Heading style={{ float: "left" }} className="text-text dark:text-text-dark text-base font-normal">
                                <Link className="!text-text dark:!text-text-dark" href="https://nestri.io">Nestri</Link>
                            </Heading>
                            <Heading style={{ float: "right" }} className="text-text dark:text-text-dark text-base font-normal">
                                Your Games. Your Rules.
                            </Heading>
                        </Section>
                    </Container>
                </Body>
            </Tailwind>
        </Html >
    )
}