import { z } from "zod";
import { fn } from "../utils";
import { Steam } from "../steam";
import { useSteamID, useUserID } from "../actor";
import { friendTable } from "./friend.sql";
import { userTable } from "../user/user.sql";
import { steamTable } from "../steam/steam.sql";
import { createSelectSchema } from "drizzle-zod";
import { and, eq, isNull, sql } from "drizzle-orm";
import { createTransaction, useTransaction } from "../drizzle/transaction";

export namespace Friend {
    export const Info = createSelectSchema(friendTable)
        .omit({ timeCreated: true, timeDeleted: true, timeUpdated: true })

    export type Info = z.infer<typeof Info>;

    export const add = fn(
        Info.partial({ steamID: true }),
        async (input) =>
            createTransaction(async (tx) => {
                const steamID = input.steamID ?? useSteamID()
                
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
            )
    )

    export const list = fn(
        z.void(),
        async () =>
            useTransaction(async (tx) => {
                const userSteamAccounts =
                    await tx
                        .select()
                        .from(steamTable)
                        .where(eq(steamTable.userID, useUserID()))
                        .execute();

                if (userSteamAccounts.length === 0) {
                    return []; // User has no steam accounts
                }

                const friendPromises =
                    userSteamAccounts.map(async (steamAccount) => {
                        return await fromSteamID(steamAccount.steamID)
                    })

                return (await Promise.all(friendPromises)).flat()
            })
    )

    export const fromSteamID = fn(
        Info.shape.steamID,
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
                        eq(friendTable.friendSteamID, steamTable.steamID)
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
                    .then((rows) => Steam.serializeFull(rows))
            )
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
            })
    )

}