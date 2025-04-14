import { theme } from "./theme";
import { utility } from "./utility";
import { Container } from "./layout";
import { styled } from "@macaron-css/solid"
import { CSSProperties } from "@macaron-css/core";
import { ComponentProps, For, JSX, Show, splitProps } from "solid-js";

// FIXME: Make sure the focus ring goes to red when the input is invalid

export const inputStyles: CSSProperties = {
    lineHeight: theme.font.lineHeight,
    appearance: "none",
    width: "100%",
    fontSize: theme.font.size.sm,
    borderRadius: theme.borderRadius,
    padding: `0 ${theme.space[3]}`,
    height: theme.input.size.base,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: theme.color.gray.d400,
    color: theme.color.d1000.gray,
    backgroundColor: theme.color.background.d100,
};

export const inputDisabledStyles: CSSProperties = {
    opacity: 0.5,
    backgroundColor: theme.color.background.d200,
    color: theme.color.gray.d400,
    cursor: "default",
    // boxShadow: `0 0 0 1px inset ${theme.color.input.border}`,
};

export const inputFocusStyles: CSSProperties = {
    outlineOffset: 3,
    outline: `${theme.color.gray.d600} solid 2px`,
};

export const inputDangerTextStyles: CSSProperties = {
    color: theme.color.red.d700,
};

export const inputDangerFocusStyles: CSSProperties = {
    ...inputDangerTextStyles,
    outlineColor: theme.color.red.d700,
    // boxShadow: `
    //   0 0 1px 1px inset hsla(${theme.color.red.l2}, 100%),
    //   ${theme.color.input.shadow}
    // `,
};

export const Root = styled("label", {
    base: {
        ...utility.stack(2),
    },
    variants: {
        color: {
            primary: {
                color: theme.color.gray.d900
            },
            danger: {
                color: theme.color.gray.d900,
            },
        },
    },
    defaultVariants: {
        color: "primary",
    },
});

type FormFieldProps = ComponentProps<typeof Root> & {
    hint?: JSX.Element;
    label?: string;
};

export const Input = styled("input", {
    base: {
        ...inputStyles,
        ":focus": {
            ...inputFocusStyles,
        },
        ":disabled": {
            ...inputDisabledStyles,
        },
        "::placeholder": {
            color: theme.color.gray.d800
        },
        selectors: {
            "[data-type='url'] &": {
                borderTopLeftRadius: 0,
                borderBottomLeftRadius: 0,
            }
        }
        // ":invalid":{
        //     ...inputDangerFocusStyles
        // },
        // selectors: {
        //     [`${Root.selector({ color: "danger" })} &`]: {
        //         ...inputDangerFocusStyles,
        //     },
        // },
    },
    variants: {
        color: {
            primary: {},
            danger: {
                ...inputDangerFocusStyles,
                ":focus": {
                    ...inputDangerFocusStyles,
                },
            },
        },
        size: {
            sm: {
                height: theme.input.size.sm,
            },
        },
    },
    defaultVariants: {
        color: "primary",
    },
});

export const InputRadio = styled("input", {
    base: {
        padding: 0,
        WebkitAppearance: "none",
        appearance: "none",
        /* Not removed via appearance */
        margin: 0,
        font: "inherit",
        color: "currentColor",
        width: "1.15em",
        height: "1.15em",
        border: "0.15em solid currentColor",
        borderRadius: "50%",
        transform: "translateY(-0.075em)",
        display: "grid",
        position: "relative",
        placeContent: "center",
        ":before": {
            content: "",
            width: "0.68em",
            height: "0.68em",
            borderRadius: "50%",
            transform: " scale(0)",
            transition: "120ms transform ease-in-out",
            boxShadow: `inset 1em 1em ${theme.color.blue.d700}`
        },
        selectors: {
            "&:checked::before": {
                transform: "scale(1)"
            }
        }
    }
});

const Label = styled("p", {
    base: {
        fontWeight: 500,
        textAlign: "left",
        letterSpacing: -0.1,
        fontSize: theme.font.size.mono_sm,
        textTransform: "capitalize",
        fontFamily: theme.font.family.heading,
    },
});

const InputLabel = styled("label", {
    base: {
        letterSpacing: -0.1,
        fontSize: theme.font.size.sm,
        lineHeight: theme.font.lineHeight,
        height: theme.input.size.base,
        appearance: "none",
        padding: `0 ${theme.space[3]}`,
        borderWidth: 0,
        borderBottomWidth: 1,
        borderStyle: "solid",
        borderColor: theme.color.gray.d400,
        color: theme.color.gray.d800,
        backgroundColor: theme.color.background.d100,
        transition: "all 0.3s cubic-bezier(0.4,0,0.2,1)",
        position: "relative",
        display: "flex",
        alignItems: "center",
        cursor: "pointer",
        gap: "1em",
        ":focus-within": {
            color: theme.color.d1000.gray
        },
        ":first-child": {
            borderTopRightRadius: theme.borderRadius,
            borderTopLeftRadius: theme.borderRadius,
        },
        ":last-child": {
            borderBottomWidth: 0,
            borderBottomRightRadius: theme.borderRadius,
            borderBottomLeftRadius: theme.borderRadius,
        },
        ":hover": {
            backgroundColor: theme.color.grayAlpha.d200,
            color: theme.color.d1000.gray
        },
        selectors: {
            "&:has(input:checked)": {
                color: theme.color.d1000.gray
            }
        }
    },
});

const Hint = styled("p", {
    base: {
        fontSize: theme.font.size.xs,
        lineHeight: theme.font.lineHeight,
        color: theme.color.gray.d800,
        textAlign: "left"
    },
    variants: {
        color: {
            primary: {},
            danger: {
                color: theme.color.red.d700,
            },
        },
    },
    defaultVariants: {
        color: "primary",
    },
});

export function FormField(props: FormFieldProps) {
    return (
        <Root {...props}>
            <Container space="2">
                <Show when={props.label}>
                    <Label color={props.color}>{props.label}</Label>
                </Show>
                {props.children}
            </Container>
            <Show when={props.hint}>
                <Hint color={props.color}>{props.hint!}</Hint>
            </Show>
        </Root>
    );
}

type SelectProps = {
    name: string;
    value: any;
    ref: (element: HTMLInputElement) => void;
    onInput: JSX.EventHandler<HTMLInputElement, InputEvent>;
    onChange: JSX.EventHandler<HTMLInputElement, Event>;
    onBlur: JSX.EventHandler<HTMLInputElement, FocusEvent>;
    options: { label: string; value: string }[];
    badges?: { label: string; color: keyof typeof theme.color.d1000 }[];
    required?: boolean;
    class?: string;
};

const InputRadioContainer = styled("div", {
    base: {
        ...inputStyles,
        display: "flex",
        userSelect: "none",
        flexDirection: "column",
        height: "auto",
        position: "relative",
        padding: 0,
    }
})

const Badge = styled("div", {
    base: {
        color: "#FFF",
        marginLeft: "auto",
        borderRadius: 9999,
        letterSpacing: 0.5,
        padding: "0 6px",
        fontSize: theme.font.size.xs
    }
})

export function Select(props: SelectProps) {
    // Split select element props
    const [, inputProps] = splitProps(props, [
        'class',
        'value',
        'options',
        'badges',
    ]);

    return (
        <InputRadioContainer>
            <For each={props.options}>
                {({ label, value }, key) => (
                    <InputLabel for={label}>
                        <InputRadio
                            {...inputProps}
                            type="radio"
                            value={value}
                            id={label}
                        />
                        {label}
                        <Show when={props.badges}>
                            {props.badges &&
                                <Badge style={{ "background-color": theme.color[props.badges[key()].color].d700 }}>
                                    {props.badges[key()].label}
                                </Badge>
                            }
                        </Show>
                    </InputLabel>
                )}
            </For>

        </InputRadioContainer >
    );
}