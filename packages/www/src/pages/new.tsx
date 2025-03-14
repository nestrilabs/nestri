import * as v from "valibot"
import { Button } from "@nestri/www/ui";
import { Text } from "@nestri/www/ui/text";
import { styled } from "@macaron-css/solid";
import { theme } from "@nestri/www/ui/theme";
import { useNavigate } from "@solidjs/router";
import { useOpenAuth } from "@openauthjs/solid";
import { utility } from "@nestri/www/ui/utility";
import { useAccount } from "../providers/account";
import { createForm, getValue, setError, valiForm } from "@modular-forms/solid";
import { Container, FullScreen } from "@nestri/www/ui/layout";
import { FormField, Input, Select } from "@nestri/www/ui/form";
import { Team } from "@nestri/core/team/index";
import { Show } from "solid-js";

const nameRegex = /^[a-z0-9\-]+$/

const FieldList = styled("div", {
    base: {
        width: "100%",
        maxWidth: 380,
        ...utility.stack(5),
    },
});

const Hr = styled("hr", {
    base: {
        border: 0,
        backgroundColor: theme.color.gray.d400,
        width: "100%",
        height: 1,
    }
})

const Plan = {
    Pro: 'BYOG',
    Basic: 'Hosted',
} as const;

const schema = v.object({
    plan: v.pipe(
        v.enum(Plan, "Choose a valid plan"),
    ),
    name: v.pipe(
        v.string(),
        v.minLength(2, 'Use 2 characters at minimum.'),
        v.maxLength(32, 'Use 32 characters at maximum.'),
    ),
    slug: v.pipe(
        v.string(),
        v.regex(nameRegex, "Use a URL friendly name."),
        v.minLength(2, 'Use 2 characters at minimum.'),
        v.maxLength(48, 'Use 48 characters at maximum.'),
    )
})

// const Details = styled("details", {
//     base: {
//         overflow: "hidden",
//         transition: "max-height .2s ease"
//     }
// })

// const Summary = styled("summary", {
//     base: {
//         userSelect: "none",
//         cursor: "pointer",
//         listStyle: "none"
//     }
// })

// const SVG = styled("svg", {
//     base: {
//         color: theme.color.gray.d900,
//         width: 20,
//         height: 20,
//         marginRight: theme.space[2]
//     }
// })

// const Subtitle = styled("p", {
//     base: {
//         color: theme.color.gray.d900,
//         fontSize: theme.font.size.sm,
//         fontWeight: theme.font.weight.regular,
//         lineHeight: "1rem"
//     }
// })

const UrlParent = styled("div", {
    base: {
        display: "flex",
        width: "100%",
    }
})

const UrlTitle = styled("span", {
    base: {
        borderWidth: 1,
        borderRight: 0,
        display: "flex",
        alignItems: "center",
        borderStyle: "solid",
        color: theme.color.gray.d900,
        fontSize: theme.font.size.sm,
        padding: `0 ${theme.space[3]}`,
        height: theme.input.size.base,
        borderColor: theme.color.gray.d400,
        borderTopLeftRadius: theme.borderRadius,
        borderBottomLeftRadius: theme.borderRadius,
    }
})

export function CreateTeamComponent() {
    const [form, { Form, Field }] = createForm({
        validate: valiForm(schema),
    });

    const nav = useNavigate();
    const auth = useOpenAuth();
    const account = useAccount();

    return (
        <FullScreen>
            <Container horizontal="center" style={{ width: "100%", padding: "1rem", }} space="1" >
                <Container style={{ "width": "100%", "max-width": "380px" }} horizontal="start" space="3" >
                    <Text font="heading" spacing="none" size="3xl" weight="semibold">
                        Create a Team
                    </Text>
                    <Text style={{ color: theme.color.gray.d900 }} size="sm">
                        Choose something that your team mates will recognize
                    </Text>
                    <Hr />
                </Container>
                <Form style={{ width: "100%", "max-width": "380px" }}
                    onsubmit={async (data) => {
                        console.log("submitting", data);
                        const result = await fetch(
                            import.meta.env.VITE_API_URL + "/team",
                            {
                                method: "POST",
                                headers: {
                                    authorization: `Bearer ${await auth.access()}`,
                                    "content-type": "application/json",
                                },
                                body: JSON.stringify(data),
                            },
                        );
                        if (!result.ok) {
                            setError(form, "slug", "Team slug is already taken.");
                            return;
                        }
                        const team = (await result.json()).data as Team.Info;
                        await account.refresh(account.current.email);
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        nav(`/${team.slug}`);
                    }}
                >
                    <FieldList>
                        <Field type="string" name="name">
                            {(field, props) => (
                                <FormField
                                    label="Team Name"
                                    hint={
                                        field.error
                                        && field.error
                                    }
                                    color={field.error ? "danger" : "primary"}
                                >
                                    <Input
                                        {...props}
                                        autofocus
                                        placeholder="Jane Doe's Team"
                                    />
                                </FormField>
                            )}
                        </Field>
                        <Field type="string" name="slug">
                            {(field, props) => (
                                <FormField
                                    label="Team Slug"
                                    hint={
                                        field.error
                                        && field.error
                                    }
                                    color={field.error ? "danger" : "primary"}
                                >
                                    <UrlParent
                                        data-type='url'
                                    >
                                        <UrlTitle>
                                            nestri.io/
                                        </UrlTitle>
                                        <Input
                                            {...props}
                                            autofocus
                                            placeholder={
                                                getValue(form, "name")?.toString()
                                                    .split(" ").join("-")
                                                    .toLowerCase() || "janes-team"}
                                        />
                                    </UrlParent>
                                </FormField>
                            )}
                        </Field>
                        <Field type="string" name="plan">
                            {(field, props) => (
                                <FormField
                                    label="Plan Type"
                                    hint={
                                        field.error
                                        && field.error
                                    }
                                    color={field.error ? "danger" : "primary"}
                                >
                                    <Select
                                        {...props}
                                        required
                                        value={field.value}
                                        badges={[
                                            { label: "BYOG", color: "purple" },
                                            { label: "Hosted", color: "blue" },
                                        ]}
                                        options={[
                                            { label: "I'll be playing on my machine", value: 'BYOG' },
                                            { label: "I'll be playing on the cloud", value: 'Hosted' },
                                        ]}
                                    />
                                </FormField>
                            )}
                        </Field>
                        {/* <Details>
                            <Summary>
                                <div style={{ "display": "flex", "align-items": "center" }}>
                                    <SVG xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><path fill="currentColor" d="M8.59 16.59L13.17 12L8.59 7.41L10 6l6 6l-6 6z" /></SVG>
                                    <Subtitle>
                                        Continuing will start a 14-day Pro plan trial.
                                    </Subtitle>
                                </div>
                            </Summary>
                        </Details> */}
                        <Button color="brand" disabled={form.submitting} >
                            <Show when={form.submitting} fallback="Continue">
                                Creating&hellip;
                            </Show>
                        </Button>
                    </FieldList>
                </Form>
            </Container>

        </FullScreen>
    )
}