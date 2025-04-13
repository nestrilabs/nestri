import { z } from "zod";
import { Common } from "../common";
import { Examples } from "../examples";
import { createID, fn } from "../utils";
import { useUser, useUserID } from "../actor";
import { eq, and, isNull, sql } from "../drizzle";
import { steamTable, AccountLimitation, LastGame } from "./steam.sql";
import { createTransaction, useTransaction } from "../drizzle/transaction";

export namespace Steam {
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
            steamEmail: z.string().openapi({
                description: "The email regisered with this Steam account",
                example: Examples.Steam.steamEmail
            }),
            steamID: z.number().openapi({
                description: "The Steam ID this Steam account",
                example: Examples.Steam.steamID
            }),
            limitation: AccountLimitation.openapi({
                description: " The limitations of this Steam account",
                example: Examples.Steam.limitation
            }),
            lastGame: LastGame.openapi({
                description: "The last game played on this Steam account",
                example: Examples.Steam.lastGame
            }),
            userID: z.string().openapi({
                description: "The unique id of the user who owns this steam account",
                example: Examples.Steam.userID
            }),
            username: z.string().openapi({
                description: "The unique username of this steam user",
                example: Examples.Steam.username
            }),
            personaName: z.string().openapi({
                description: "The last recorded persona name used by this account",
                example: Examples.Steam.personaName
            }),
            countryCode: z.string().openapi({
                description: "The country this account is connected from",
                example: Examples.Steam.countryCode
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
        }),
        (input) =>
            createTransaction(async (tx) => {
                const id = input.id ?? createID("steam");
                const user = useUser()
                await tx.insert(steamTable).values({
                    id,
                    lastSeen: sql`now()`,
                    userID: input.userID ?? user.userID,
                    countryCode: input.countryCode,
                    username: input.username,
                    steamID: input.steamID,
                    lastGame: input.lastGame,
                    limitation: input.limitation,
                    steamEmail: input.steamEmail,
                    avatarUrl: input.avatarUrl,
                    personaName: input.personaName,
                })
                return id;
            }),
    );

    export const fromUserID = fn(
        z.string(),
        (userID) =>
            useTransaction((tx) =>
                tx
                    .select()
                    .from(steamTable)
                    .where(and(eq(steamTable.userID, userID), isNull(steamTable.timeDeleted)))
                    .execute()
                    .then((rows) => rows.map(serialize).at(0)),
            ),
    )

    export const list = () =>
        useTransaction((tx) =>
            tx
                .select()
                .from(steamTable)
                .where(and(eq(steamTable.userID, useUserID()), isNull(steamTable.timeDeleted)))
                .execute()
                .then((rows) => rows.map(serialize)),
        )

    /**
     * Serializes a raw Steam table record into a standardized Info object.
     *
     * This function maps the fields from a database record (retrieved from the Steam table) to the
     * corresponding properties defined in the Info schema.
     *
     * @param input - A raw record from the Steam table containing user information.
     * @returns An object conforming to the Info schema.
     */
    export function serialize(
        input: typeof steamTable.$inferSelect,
    ): z.infer<typeof Info> {
        return {
            id: input.id,
            userID: input.userID,
            countryCode: input.countryCode,
            username: input.username,
            avatarUrl: input.avatarUrl,
            personaName: input.personaName,
            steamEmail: input.steamEmail,
            steamID: input.steamID,
            limitation: input.limitation,
            lastGame: input.lastGame,
        };
    }

}