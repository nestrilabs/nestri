import { z } from "zod";
import { Examples } from "../examples";
import { fn } from "../utils";
import { createTransaction, useTransaction } from "../drizzle/transaction";
import { friendTable } from "./friend.sql";
import { and, eq, isNull, sql } from "drizzle-orm";

export namespace Friend {
    export const Info = z
        .object({
            steamID: z.bigint().openapi({
                description: "The Steam ID of this Steam account",
                example: Examples.Friend.steamID
            }),
            friendSteamID: z.bigint().openapi({
                description: "The friend's Steam ID we want to add as a friend",
                example: Examples.Friend.friendSteamID
            }),
            createdAt: z.date().openapi({
                description: "When this friendship was created",
                example: Examples.Friend.createdAt
            }),
            deletedAt: z.date().nullable().openapi({
                description: "When this friendship was ended",
                example: Examples.Friend.deletedAt
            }),
            updatedAt: z.date().openapi({
                description: "When this friendship was updated",
                example: Examples.Friend.updatedAt
            })
        })
        .openapi({
            ref: "Friend",
            description: "Represents a user's friendship connection",
            example: Examples.Friend,
        });

    export type Info = z.infer<typeof Info>;

    export const add = fn(
        Info.omit({
            createdAt: true,
            deletedAt: true,
            updatedAt: true
        }),
        async (input) =>
            createTransaction(async (tx) => {
                await tx
                    .insert(friendTable)
                    .values({
                        steamID: input.steamID,
                        friendSteamID: input.friendSteamID
                    })
                    .onConflictDoUpdate({
                        target: [friendTable.steamID, friendTable.friendSteamID],
                        set: { timeDeleted: null }
                    })
                return input.steamID
            }),
    )

    export const end = fn(
        Info.pick({
            steamID: true,
            friendSteamID: true
        }),
        (input) =>
            useTransaction(async (tx) =>
                tx
                    .update(friendTable)
                    .set({ timeDeleted: sql`now()` })
                    .where(
                        and(
                            eq(friendTable.steamID, input.steamID),
                            eq(friendTable.friendSteamID, input.friendSteamID),
                        )
                    )
            ),
    )

    export const fromSteamID = fn(
        Info.pick({
            steamID: true
        }),
        (input) =>
            useTransaction(async (tx) =>
                tx
                    .select()
                    .from(friendTable)
                    .where(and(eq(friendTable.steamID, input.steamID), isNull(friendTable.timeDeleted)))
                    .orderBy(friendTable.timeCreated)
                    .limit(100)
                    .execute()
                    .then((rows) => rows.map(serialize)),
            ),
    )

    export const areFriends = fn(
        Info.pick({
            steamID: true,
            friendSteamID: true
        }),
        (input) =>
            useTransaction(async (tx) => {
                const result = await tx
                    .select()
                    .from(friendTable)
                    .where(
                        and(
                            eq(friendTable.steamID, input.steamID),
                            eq(friendTable.friendSteamID, input.friendSteamID),
                            isNull(friendTable.timeDeleted)
                        )
                    )
                    .limit(1)
                    .execute()

                return result.length > 0
            }),
    )

    export function serialize(
        input: typeof friendTable.$inferSelect,
    ): z.infer<typeof Info> {
        return {
            // TODO: Do some leftJoin shenanigans
            friendSteamID: input.friendSteamID,
            createdAt: input.timeCreated,
            deletedAt: input.timeDeleted,
            updatedAt: input.timeUpdated,
            steamID: input.steamID
        };
    }
}