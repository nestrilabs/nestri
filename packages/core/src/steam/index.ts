import { z } from "zod";
import { Common } from "../common";
import { useUser, useUserID } from "../actor";
import { Examples } from "../examples";
import { createID, fn } from "../utils";
import { steamTable } from "./steam.sql";
import { eq, and, isNull } from "../drizzle";
import { createTransaction, useTransaction } from "../drizzle/transaction";

export module Steam {
    export const Info = z
        .object({
            id: z.string().openapi({
                description: Common.IdDescription,
                example: Examples.Steam.id,
            }),
            avatarUrl: z.string().openapi({
                description: "The avatar url of this Steam account",
                example: Examples.Steam.avatarUrl
            }),
            userID: z.string().openapi({
                description: "The unique id of the user who owns this steam account",
                example: Examples.Steam.userID
            }),
            email: z.string().openapi({
                description: "The email of this steam user",
                example: Examples.Steam.email
            }),
            username: z.string().openapi({
                description: "The unique username of this steam user",
                example: Examples.Steam.username
            }),
            personaName: z.string().openapi({
                description: "The last recorded persona name used by this account",
                example: Examples.Steam.personaName
            }),
            country: z.string().openapi({
                description: "The country this account is connected from",
                example: Examples.Steam.country
            })
        })
        .openapi({
            ref: "Steam",
            description: "Represents a steam user's information stored on Nestri",
            example: Examples.Steam,
        });

    export type Info = z.infer<typeof Info>;

    export const create = fn(
        Info.partial({
            id: true,
            userID: true,
            email: true,
        }).extend({
            accessToken: z.string()
        }),
        (input) =>
            createTransaction(async (tx) => {
                const id = input.id ?? createID("steam");
                const user = useUser()
                await tx.insert(steamTable).values({
                    id,
                    email: input.email ?? user.email,
                    userID: input.userID ?? user.userID,
                    country: input.country,
                    username: input.username,
                    avatarUrl: input.avatarUrl,
                    personaName: input.personaName,
                    accessToken: input.accessToken,
                })
                return id;
            }),
    );

    export const list = () =>
        useTransaction((tx) =>
            tx
                .select()
                .from(steamTable)
                .where(and(eq(steamTable.userID, useUserID()), isNull(steamTable.timeDeleted)))
                .execute()
                .then((rows) => rows.map(serialize)),
        )

    export function serialize(
        input: typeof steamTable.$inferSelect,
    ): z.infer<typeof Info> {
        return {
            id: input.id,
            email: input.email,
            userID: input.userID,
            country: input.country,
            username: input.username,
            avatarUrl: input.avatarUrl,
            personaName: input.personaName
        };
    }

}