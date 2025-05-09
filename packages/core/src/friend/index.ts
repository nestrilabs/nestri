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
            example: { ...Examples.SteamAccount, user: Examples.User },
        });

    export const InputInfo = createSelectSchema(friendTable)
        .omit({ timeCreated: true, timeDeleted: true, timeUpdated: true })

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

    export const list = async () =>
        useTransaction(async (tx) => {
            const userSteamAccounts =
                await tx
                    .select()
                    .from(steamTable)
                    .where(eq(steamTable.userID, Actor.userID()))
                    .execute();

            if (userSteamAccounts.length === 0) {
                return []; // User has no steam accounts
            }

            const friendPromises =
                userSteamAccounts.map(async (steamAccount) => {
                    return await fromSteamID(steamAccount.id)
                })

            return (await Promise.all(friendPromises)).flat()
        })

    export const fromSteamID = fn(
        InputInfo.shape.steamID,
        (steamID) =>
            useTransaction(async (tx) =>
                tx
                    .select({
                        steam: steamTable,
                        user: userTable
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
                            eq(friendTable.steamID, steamID),
                            isNull(friendTable.timeDeleted)
                        )
                    )
                    .orderBy(friendTable.timeCreated)
                    .limit(100)
                    .execute()
                    .then((rows) => serialize(rows))
            )
    )

    export const areFriends = fn(
        InputInfo,
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
            })
    )

    export function serialize(
        input: { user: typeof userTable.$inferSelect | null; steam: typeof steamTable.$inferSelect }[],
    ): z.infer<typeof Info>[] {
        return pipe(
            input,
            groupBy((row) => row.steam.id.toString()),
            values(),
            map((group) => ({
                ...Steam.serialize(group[0].steam),
                user: group[0].user ? User.serialize(group[0].user!) : null
            }))
        )
    }

}