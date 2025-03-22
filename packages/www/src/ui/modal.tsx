import { theme } from "./theme";
import { Portal } from "solid-js/web";
import { ParentProps } from "solid-js";
import { styled } from "@macaron-css/solid";
import { createEventListener } from "@solid-primitives/event-listener";

const Root = styled("div", {
    base: {
        position: "fixed",
        // backgroundColor: theme.color.background.overlay,
        opacity: 0,
        inset: 0,
        display: "flex",
        justifyContent: "center",
        alignItems: "start",
        pointerEvents: "none",
        transition: "200ms opacity",
        paddingTop: "10vh",
        zIndex: 10,
    },
    variants: {
        show: {
            true: {
                opacity: 1,
                pointerEvents: "all",
                backdropFilter: "blur(2px)",
                WebkitBackdropFilter: "blur(2px)",
            },
        },
    },
});

const Content = styled("div", {
    base: {
        borderRadius: 10,
        flexShrink: 0,
        // boxShadow: theme.color.shadow.drop.long,
        // backdropFilter: "blur(10px)",
        // WebkitBackdropFilter: "blur(10px)",
        background: theme.color.background.d200,
        transform: "scale(0.95)",
        transition: "200ms all",
        selectors: {
            [`${Root.selector({ show: true })} &`]: {
                transform: "initial",
            },
        },
    },
});

export function Modal(
    props: ParentProps<{ show: boolean; onClose: () => void }>,
) {
    let content!: HTMLDivElement;
    createEventListener(document, "mouseup", (e) => {
        if (!props.show) return;
        if (!content.contains(e.target as Node)) {
            props.onClose();
        }
    });

    createEventListener(window, "keydown", (e) => {
        if (e.key === "Escape") {
            if (!props.show) return;
            props.onClose();
        }
    });

    return (
        <Portal mount={document.getElementById("styled")!}>
            <Root show={props.show}>
                <Content ref={content}>{props.children}</Content>
            </Root>
        </Portal>
    );
}