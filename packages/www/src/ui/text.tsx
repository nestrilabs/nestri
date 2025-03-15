import { theme } from "./theme";
import { styled } from "@macaron-css/solid";
import { utility } from "./utility";
import { CSSProperties } from "@macaron-css/core";

export const Text = styled("span", {
    // base: {
    //     textWrap: "balance"
    // },
    variants: {
        leading: {
            base: {
                lineHeight: 1,
            },
            normal: {
                lineHeight: "normal",
            },
            loose: {
                lineHeight: theme.font.lineHeight,
            },
        },
        align: {
            left: {
                textAlign: "left"
            },
            center: {
                textAlign: "center"
            }
        },
        spacing: {
            none: {
                letterSpacing: 0
            },
            xs: {
                letterSpacing: -0.96
            },
            sm: {
                letterSpacing: -0.96
            },
            md: {
                letterSpacing: -1.28
            },
            lg: {
                letterSpacing: -1.28
            }
        },
        code: {
            true: {
                fontFamily: theme.font.family.code,
            },
        },
        capitalize: {
            true: {
                textTransform: "capitalize",
            },
        },
        uppercase: {
            true: {
                letterSpacing: 0.5,
                textTransform: "uppercase",
            },
        },
        weight: {
            regular: {
                fontWeight: theme.font.weight.regular,
            },
            medium: {
                fontWeight: theme.font.weight.medium,
            },
            semibold: {
                fontWeight: theme.font.weight.semibold,
            },
        },
        center: {
            true: {
                textAlign: "center",
            },
        },
        line: {
            true: {
                ...utility.text.line,
            },
        },
        disableSelect: {
            true: {
                userSelect: "none",
                WebkitUserSelect: "none",
            },
        },
        pre: {
            true: {
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
            },
        },
        underline: {
            true: {
                textUnderlineOffset: 2,
                textDecoration: "underline",
            },
        },
        label: {
            true: {
                fontWeight: 500,
                letterSpacing: 0.5,
                textTransform: "uppercase",
                fontFamily: theme.font.family.code,
            },
        },
        break: {
            true: {
                wordBreak: "break-all",
            },
            false: {},
        },
        size: (() => {
            const result = {} as Record<`${keyof typeof theme.font.size}`, any>;
            for (const [key, value] of Object.entries(theme.font.size)) {
                result[key as keyof typeof theme.font.size] = {
                    fontSize: value,
                };
            }
            return result;
        })(),
        font: (() => {
            const result = {} as Record<`${keyof typeof theme.font.family}`, any>;
            for (const [key, value] of Object.entries(theme.font.family)) {
                result[key as keyof typeof theme.font.family] = {
                    fontFamily: value,
                };
            }
            return result;
        })(),
        color: (() => {
            const record = {} as Record<keyof typeof theme.color.text, CSSProperties>;
            for (const [key, _value] of Object.entries(theme.color.text)) {
                record[key as keyof typeof record] = {};
            }
            return record;
        })(),
        on: (() => {
            const record = {} as Record<
                keyof typeof theme.color.text.primary,
                CSSProperties
            >;
            for (const [key, _value] of Object.entries(theme.color.text.primary)) {
                record[key as keyof typeof record] = {};
            }
            return record;
        })(),
    },
    compoundVariants: (() => {
        const result: any[] = [];
        for (const [color, ons] of Object.entries(theme.color.text)) {
            for (const [on, value] of Object.entries(ons)) {
                result.push({
                    variants: {
                        color,
                        on,
                    },
                    style: {
                        color: value,
                    },
                });
            }
        }
        return result;
    })(),
    defaultVariants: {
        on: "base",
        size: "base",
        color: "primary",
        spacing: "none",
        weight: "regular",
    },
});