import { z } from "zod";
import { createID, fn } from "../utils";
import { Common } from "../common";
import { Examples } from "../examples";
import { init } from "@instantdb/admin";
import schema from "../../instant.schema";
import { Resource } from "sst"

const db = init({
    appId: Resource.InstantAppId.value,
    adminToken: Resource.InstantAdminToken.value,
    schema
});

export module User {
    export const Info = z
        .object({
            id: z.string().openapi({
                description: Common.IdDescription,
                example: Examples.User.id,
            }),
            name: z.string().nullable().openapi({
                description: "Name of the user.",
                example: Examples.User.name,
            }),
            email: z.string().nullable().openapi({
                description: "Email address of the user.",
                example: Examples.User.email,
            }),
            fingerprint: z.string().nullable().openapi({
                description:
                    "The user's fingerprint, derived from their public SSH key.",
                example: Examples.User.fingerprint,
            })
        })
        .openapi({
            ref: "User",
            description: "A Nestri console user.",
            example: Examples.User,
        });
    export const fromEmail = fn(z.string(), async (email) => {
        const query = {
            profiles: {
                $: {
                    where: {
                        email: email,
                        //TODO: check whether it is deleted
                    },
                },
            },
        };

        const res = await db.query(query) //.queryOnce(query)
        console.log("email search", res)
        return res.profiles
    })

    export const create = fn(z.string(), async (email) => {
        const query = {
            profiles: {
                $: {
                    where: {
                        email: email,
                        //TODO: check whether it is deleted
                    },
                },
            },
        };

        const res = await db.query(query) //.queryOnce(query)

        return res.profiles
    })

    export const createToken = fn(
        z.object({
            email: z.string()
        }),
        async (input) => {
            const token = await db.auth.createToken(input.email)

            return token;
        },
    );
}