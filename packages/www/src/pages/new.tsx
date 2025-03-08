import * as v from "valibot"
import { styled } from "@macaron-css/solid";
import { Text } from "@nestri/www/ui/text";
import { utility } from "@nestri/www/ui/utility";
import { theme } from "@nestri/www/ui/theme";
import { FormField, Input, Select } from "@nestri/www/ui/form";
import { Container, FullScreen } from "@nestri/www/ui/layout";
import { createForm, required, email, valiForm } from "@modular-forms/solid";
import { Button } from "@nestri/www/ui";

// const nameRegex = /^[a-z]+$/

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
    Pro: 'Pro',
    Basic: 'Basic',
} as const;

const schema = v.object({
    plan: v.pipe(
        v.enum(Plan),
    ),
    display_name: v.pipe(
        v.string(),
        v.maxLength(32, 'Please use 32 characters at maximum.'),
    ),
    slug: v.pipe(
        v.string(),
        v.minLength(2, 'Please use 2 characters at minimum.'),
        // v.regex(nameRegex, "Use only small letters, no numbers or special characters"),
        v.maxLength(48, 'Please use 48 characters at maximum.'),
    )
})

export function CreateTeamComponent() {
    const [form, { Form, Field }] = createForm({
        validate: valiForm(schema),
    });

    return (
        <FullScreen>
            <Container horizontal="center" style={{ width: "100%", padding: "1rem", }} space="1" >
                <Container style={{ "width": "100%","max-width": "380px" }} horizontal="start" space="3" >
                    <Text font="heading" spacing="none" size="3xl" weight="semibold">
                        Create a Team
                    </Text>
                    <Text style={{ color: theme.color.gray.d900 }} size="sm">
                        Choose something that your teammates will recognize
                    </Text>
                    <Hr />
                </Container>
                <Form style={{ width: "100%", "max-width": "380px" }}>
                    <FieldList>
                        <Field type="string" name="slug">
                            {(field, props) => (
                                <FormField
                                    label="Team Name"
                                    hint={
                                        field.error
                                        && field.error
                                        // : "Needs to be lowercase, unique, and URL friendly."
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
                        <Field type="string" name="plan">
                            {(field, props) => (
                                <FormField
                                    label="Plan Type"
                                    hint={
                                        field.error
                                        && field.error
                                        // : "Needs to be lowercase, unique, and URL friendly."
                                    }
                                    color={field.error ? "danger" : "primary"}
                                >
                                    <Select
                                        {...props}
                                        value={field.value}
                                        badges={[
                                            { label: "Basic", color: "gray" },
                                            { label: "Pro", color: "blue" }
                                        ]}
                                        options={[
                                            { label: "I'll be playing all by myself", value: 'Basic' },
                                            { label: "I'll be playing with friends and family", value: 'Pro' },
                                        ]}
                                    />
                                </FormField>
                            )}
                        </Field>
                        <Button color="brand">
                            Continue
                        </Button>
                    </FieldList>
                </Form>
            </Container>

        </FullScreen>
    )
}