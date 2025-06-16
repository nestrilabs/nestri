import { Show } from "solid-js";
import { A } from "@solidjs/router";
import { Text } from "@nestri/www/ui/text";
import { styled } from "@macaron-css/solid";
import { theme } from "@nestri/www/ui/theme";
import { Header } from "@nestri/www/pages/steam/header";
import { Screen as FullScreen, Container } from "@nestri/www/ui/layout";

const NotAllowedDesc = styled("div", {
    base: {
        fontSize: theme.font.size.base,
        color: theme.color.gray.d900,
    },
});

const HomeLink = styled(A, {
    base: {
        fontSize: theme.font.size.base,
        textUnderlineOffset: 1,
        color: theme.color.blue.d900
    },
});

interface ErrorScreenProps {
    inset?: "none" | "header";
    message?: string;
    header?: boolean;
}

export function NotFound(props: ErrorScreenProps) {
    return (
      <>
        <Show when={props.header}>
          <Header />
        </Show>
        <FullScreen
          inset={props.inset ? props.inset : props.header ? "header" : "none"}
        >
          <Container space="2.5" horizontal="center">
            <Text weight="semibold" spacing="xs" size="3xl">{props.message || "Page not found"}</Text>
            <HomeLink href="/">Go back home</HomeLink>
          </Container>
        </FullScreen>
      </>
    );
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
                    <Text weight="semibold" spacing="xs" size="3xl">Access not allowed</Text>
                    <NotAllowedDesc>
                        You don't have access to this page,&nbsp;
                        <HomeLink href="/">go back home</HomeLink>.
                    </NotAllowedDesc>
                    <NotAllowedDesc>
                        Public profiles are coming soon
                    </NotAllowedDesc>
                </Container>
            </FullScreen>
        </>
    );
}