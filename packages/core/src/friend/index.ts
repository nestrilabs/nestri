import { z } from "zod";
import { fn } from "../utils";
import { User } from "../user";
import { Steam } from "../steam";
import { Actor } from "../actor";
import { Examples } from "../examples";
import { friendTable } from "./friend.sql";
import { userTable } from "../user/user.sql";
import { steamTable } from "../steam/steam.sql";
import { createSelectSchema } from "drizzle-zod";
import { and, eq, isNull, sql } from "drizzle-orm";
import { groupBy, map, pipe, values } from "remeda";
import { ErrorCodes, VisibleError } from "../error";
import { createTransaction, useTransaction } from "../drizzle/transaction";

export namespace Friend {
    export const Info = Steam.Info
        .extend({
            user: User.Info.nullable().openapi({
                description: "The user account that owns this Steam account",
                example: Examples.User
            })
        })
        .openapi({
            ref: "Friend",
            description: "Represents a friend's information stored on Nestri",
            example: Examples.Friend,
        });


    export const InputInfo = createSelectSchema(friendTable)
        .omit({ timeCreated: true, timeDeleted: true, timeUpdated: true })

    export type Info = z.infer<typeof Info>;
    export type InputInfo = z.infer<typeof InputInfo>;

    export const add = fn(
        InputInfo.partial({ steamID: true }),
        async (input) =>
            createTransaction(async (tx) => {
                const steamID = input.steamID ?? Actor.steamID()
                if (steamID === input.friendSteamID) {
                    throw new VisibleError(
                        "forbidden",
                        ErrorCodes.Validation.INVALID_PARAMETER,
                        "Cannot add yourself as a friend"
                    );
                }

                const results =
                    await tx
                        .select()
                        .from(friendTable)
                        .where(
                            and(
                                eq(friendTable.steamID, steamID),
                                eq(friendTable.friendSteamID, input.friendSteamID),
                                isNull(friendTable.timeDeleted)
                            )
                        )
                        .execute()

                if (results.length > 0) return null

                await tx
                    .insert(friendTable)
                    .values({
                        steamID,
                        friendSteamID: input.friendSteamID
                    })
                    .onConflictDoUpdate({
                        target: [friendTable.steamID, friendTable.friendSteamID],
                        set: { timeDeleted: null }
                    })

                return steamID
            }),
    )

    export const end = fn(
        InputInfo,
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
            )
    )

    export const list = () =>
        useTransaction(async (tx) =>
            tx
                .select({
                    steam: steamTable,
                    user: userTable,
                })
                .from(friendTable)
                .innerJoin(
                    steamTable,
                    eq(friendTable.friendSteamID, steamTable.id)
                )
                .leftJoin(
                    userTable,
                    eq(steamTable.userID, userTable.id)
                )
                .where(
                    and(
                        eq(friendTable.steamID, Actor.steamID()),
                        isNull(friendTable.timeDeleted)
                    )
                )
                .limit(100)
                .execute()
                .then(rows => serialize(rows))
        )

    export const fromFriendID = fn(
        InputInfo.shape.friendSteamID,
        (friendSteamID) =>
            useTransaction(async (tx) =>
                tx
                    .select({
                        steam: steamTable,
                        user: userTable,
                    })
                    .from(friendTable)
                    .innerJoin(
                        steamTable,
                        eq(friendTable.friendSteamID, steamTable.id)
                    )
                    .leftJoin(
                        userTable,
                        eq(steamTable.userID, userTable.id)
                    )
                    .where(
                        and(
                            eq(friendTable.steamID, Actor.steamID()),
                            eq(friendTable.friendSteamID, friendSteamID),
                            isNull(friendTable.timeDeleted)
                        )
                    )
                    .limit(1)
                    .execute()
                    .then(rows => serialize(rows).at(0))
            )
    )


    export const areFriends = fn(
        InputInfo.shape.friendSteamID,
        (friendSteamID) =>
            useTransaction(async (tx) => {
                const result = await tx
                    .select()
                    .from(friendTable)
                    .where(
                        and(
                            eq(friendTable.steamID, Actor.steamID()),
                            eq(friendTable.friendSteamID, friendSteamID),
                            isNull(friendTable.timeDeleted)
                        )
                    )
                    .limit(1)
                    .execute()

                return result.length > 0
            })
    )

    export function serialize(
        input: { user: typeof userTable.$inferSelect | null; steam: typeof steamTable.$inferSelect }[],
    ): z.infer<typeof Info>[] {
        return pipe(
            input,
            groupBy((row) => row.steam.id),
            values(),
            map((group) => ({
                ...Steam.serialize(group[0].steam),
                user: group[0].user ? User.serialize(group[0].user!) : null
            }))
        )
    }

}