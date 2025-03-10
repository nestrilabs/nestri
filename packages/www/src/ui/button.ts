import { theme } from "./theme";
import { styled } from "@macaron-css/solid";

export const Button = styled("button", {
    base: {
        borderRadius: 6,
        border: "1px solid transparent",
        padding: `${theme.space[2]} ${theme.space[4]}`,
        fontWeight: 500,
        letterSpacing: 0.1,
        lineHeight: "normal",
        fontFamily: theme.font.family.heading,
        textAlign: "center",
        cursor: "pointer",
        transitionDelay: "0s, 0s",
        transitionDuration: "0.2s, 0.2s",
        transitionProperty: "background-color, border",
        transitionTimingFunction: "ease-out, ease-out",
        display: "inline-flex",
        gap: theme.space[1.5],
        alignItems: "center",
        justifyContent: "center",
        ":disabled": {
            pointerEvents: "none",
        },
    },
    variants: {
        color: {
            brand: {
                backgroundColor: theme.color.brand,
                color: "#FFF",
            }
        }
    }
})