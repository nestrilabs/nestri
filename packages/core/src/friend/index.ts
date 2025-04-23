import { z } from "zod";
import { fn } from "../utils";
import { Examples } from "../examples";
import { friendTable } from "./friend.sql";
import { createSelectSchema } from "drizzle-zod";
import { and, eq, isNull, sql } from "drizzle-orm";
import { createTransaction, useTransaction } from "../drizzle/transaction";

export namespace Friend {
    export const Info = createSelectSchema(friendTable)
        .omit({ timeCreated: true, timeDeleted: true, timeUpdated: true })
        .openapi({
            ref: "Friend",
            description: "Represents a bidirectional friendship relationship between two Steam users",
            example: Examples.Friend,
        });

    export type Info = z.infer<typeof Info>;

    export const add = fn(
        Info,
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
        Info,
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
        Info,
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
            steamID: input.steamID
        };
    }
}