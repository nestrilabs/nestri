import { theme } from "./theme";
import { styled } from "@macaron-css/solid";

export const FullScreen = styled("div", {
    base: {
        inset: 0,
        display: "flex",
        position: "fixed",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.color.background.d200,
    },
    variants: {
        inset: {
            none: {},
            header: {
                top: theme.headerHeight.root,
            },
        },
    },
})

export const Container = styled("div", {
    base: {
        backgroundColor: theme.color.background.d100,
        borderColor: theme.color.gray.d400,
        padding: "64px 80px 48px",
        justifyContent: "center",
        borderStyle: "solid",
        position: "relative",
        borderRadius: 12,
        alignItems: "center",
        maxWidth: 550,
        borderWidth: 1,
        display: "flex",
    },
    variants: {
        flow: {
            column: {
                flexDirection: "column"
            },
            row: {
                flexDirection: "row"
            }
        }
    }
})