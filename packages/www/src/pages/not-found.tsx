import { Show } from "solid-js";
import { A } from "@solidjs/router";
import { Text } from "@nestri/www/ui/text";
import { styled } from "@macaron-css/solid";
import { theme } from "@nestri/www/ui/theme";
import { Header } from "@nestri/www/pages/team/header";
import { FullScreen, Container } from "@nestri/www/ui/layout";

const NotAllowedDesc = styled("div", {
    base: {
        fontSize: theme.font.size.sm,
        color: theme.color.gray.d900,
    },
});

const HomeLink = styled(A, {
    base: {
        fontSize: theme.font.size.sm,
    },
});

interface ErrorScreenProps {
    inset?: "none" | "header";
    message?: string;
    header?: boolean;
}

export function NotAllowed(props: ErrorScreenProps) {
    return (
        <>
            <Show when={props.header}>
                <Header />
            </Show>
            <FullScreen
                inset={props.inset ? props.inset : props.header ? "header" : "none"}
            >
                <Container space="2.5" horizontal="center">
                    <Text size="lg">Access not allowed</Text>
                    <NotAllowedDesc>
                        You don't have access to this page,{" "}
                        <HomeLink href="/">go back home</HomeLink>.
                    </NotAllowedDesc>
                </Container>
            </FullScreen>
        </>
    );
}