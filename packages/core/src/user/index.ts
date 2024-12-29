import { z } from "zod";
import databaseClient from "../database"
import { fn } from "../utils";
import { Common } from "../common";
import { Examples } from "../examples";

export module User {
    export const Info = z
        .object({
            id: z.string().openapi({
                description: Common.IdDescription,
                example: Examples.User.id,
            }),
            email: z.string().nullable().openapi({
                description: "Email address of the user.",
                example: Examples.User.email,
            }),
        })
        .openapi({
            ref: "User",
            description: "A Nestri console user.",
            example: Examples.User,
        });

    export const fromEmail = fn(z.string(), async (email) => {
        const db = databaseClient()
        const res = await db.auth.getUser({ email })
        return res
    })

    export const create = fn(z.string(), async (email) => {
        const db = databaseClient()
        const token = await db.auth.createToken(email)

        return token
    })
}