import { theme } from "./theme";
import { styled } from "@macaron-css/solid";

export const FullScreen = styled("div", {
    base: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        position:"relative",
        textAlign: "center",
        width: "100%",
        justifyContent: "center"
    },
    variants: {
        inset: {
            none: {},
            header: {
                paddingTop: `calc(1px + ${theme.headerHeight.root})`,
                // minHeight: `calc(100dvh - ${theme.headerHeight.root})`,
            },
        },
    },
})

export const Screen = styled("div", {
    base: {
        display: "flex",
        position: "fixed",
        inset: 0,
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        width: "100%",
        justifyContent: "center"
    },
    variants: {
        inset: {
            none: {},
            header: {
                paddingTop: `calc(1px + ${theme.headerHeight.root})`,
                minHeight: `calc(100dvh - ${theme.headerHeight.root})`,
            },
        },
    },
})

// export const Container = styled("div", {
//     base: {
//         backgroundColor: theme.color.background.d100,
//         borderColor: theme.color.gray.d400,
//         padding: "64px 80px 48px",
//         justifyContent: "center",
//         borderStyle: "solid",
//         position: "relative",
//         borderRadius: 12,
//         alignItems: "center",
//         maxWidth: 550,
//         borderWidth: 1,
//         display: "flex",
//     },
//     variants: {
//         flow: {
//             column: {
//                 flexDirection: "column"
//             },
//             row: {
//                 flexDirection: "row"
//             }
//         }
//     }
// })

export const Container = styled("div", {
    base: {
        display: "flex",
        flexDirection: "column",
    },
    variants: {
        space: (() => {
            const result = {} as Record<`${keyof (typeof theme)["space"]}`, any>;
            for (const key in theme.space) {
                const value = theme.space[key as keyof typeof theme.space];
                result[key as keyof typeof theme.space] = {
                    gap: value,
                };
            }
            return result;
        })(),
        rounded: (() => {
            const result = {} as Record<`${keyof (typeof theme)["space"]}`, any>;
            for (const key in theme.space) {
                const value = theme.space[key as keyof typeof theme.space];
                result[key as keyof typeof theme.space] = {
                    borderRadius: value,
                };
            }
            return result;
        })(),
        highlighted: {
            true: {
                borderColor: theme.color.gray.d400,
                backgroundColor: theme.color.background.d100,
                borderStyle: "solid",
                borderWidth: 1,
                padding: "64px 80px 48px",
                maxWidth: 550,
            }
        },
        flex: {
            true: {
                flex: "1 1 auto",
            },
            false: {
                flex: "0 0 auto",
            },
        },
        horizontal: {
            center: {
                alignItems: "center",
            },
            start: {
                alignItems: "flex-start",
            },
            end: {
                alignItems: "flex-end",
            },
        },
        vertical: {
            center: {
                justifyContent: "center",
            },
            start: {
                justifyContent: "flex-start",
            },
            end: {
                justifyContent: "flex-end",
            },
        },
    },
});