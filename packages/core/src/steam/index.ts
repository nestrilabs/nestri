import { z } from "zod";
import { fn } from "../utils";
import { Resource } from "sst";
import { Actor } from "../actor";
import { bus } from "sst/aws/bus";
import { Common } from "../common";
import { createEvent } from "../event";
import { Examples } from "../examples";
import { eq, and, isNull, sql, desc } from "../drizzle";
import { afterTx, createTransaction, useTransaction } from "../drizzle/transaction";
import { steamTable, StatusEnum, AccountStatusEnum, Limitations } from "./steam.sql";

export namespace Steam {
    export const Info = z
        .object({
            id: z.bigint().openapi({
                description: Common.IdDescription,
                example: Examples.SteamAccount.id
            }),
            avatarHash: z.string().openapi({
                description: "The Steam avatar hash that this account owns",
                example: Examples.SteamAccount.avatarHash
            }),
            status: z.enum(StatusEnum.enumValues).openapi({
                description: "The current connection status of this Steam account",
                example: Examples.SteamAccount.status
            }),
            accountStatus: z.enum(AccountStatusEnum.enumValues).openapi({
                description: "The current status of this Steam account",
                example: Examples.SteamAccount.accountStatus
            }),
            userID: z.string().nullable().openapi({
                description: "The user id of which account owns this steam account",
                example: Examples.SteamAccount.userID
            }),
            profileUrl: z.string().openapi({
                description: "The steam community url of this account",
                example: Examples.SteamAccount.profileUrl
            }),
            realName: z.string().openapi({
                description: "The real name behind of this Steam account",
                example: Examples.SteamAccount.realName
            }),
            name: z.string().openapi({
                description: "The name used by this account",
                example: Examples.SteamAccount.name
            }),
            lastSyncedAt: z.date().openapi({
                description: "The last time this account was synced to Steam",
                example: Examples.SteamAccount.lastSyncedAt
            }),
            limitations: Limitations.openapi({
                description: "The limitations bestowed on this Steam account by Steam",
                example: Examples.SteamAccount.limitations
            }),
            memberSince: z.date().openapi({
                description: "When this Steam community account was created",
                example: Examples.SteamAccount.memberSince
            })
        })
        .openapi({
            ref: "Steam",
            description: "Represents a steam user's information stored on Nestri",
            example: Examples.SteamAccount,
        });

    export type Info = z.infer<typeof Info>;

    export const Events = {
        AccountCreated: createEvent(
            "steam_account.created",
            z.object({
                steamID: Info.shape.id,
                userID: Info.shape.userID
            }),
        ),
        AccountUpdated: createEvent(
            "steam_account.updated",
            z.object({
                steamID: Info.shape.id,
                userID: Info.shape.userID
            }),
        )
    };

    export const create = fn(
        Info
            .extend({
                useUser: z.boolean(),
            })
            .partial({
                useUser: true,
                userID: true,
                status: true,
                accountStatus: true,
                lastSyncedAt: true
            }),
        (input) =>
            createTransaction(async (tx) => {
                const accounts =
                    await tx
                        .select()
                        .from(steamTable)
                        .where(
                            and(
                                eq(steamTable.id, input.id),
                                isNull(steamTable.timeDeleted)
                            )
                        )
                        .execute()
                        .then((rows) => rows.map(serialize))

                // Update instead of create
                if (accounts.length > 0) return null

                const userID = typeof input.userID === "string" ? input.userID : input.useUser ? Actor.userID() : null;
                await tx
                    .insert(steamTable)
                    .values({
                        ...input,
                        userID,
                        status: input.status ?? "offline",
                        accountStatus: input.accountStatus ?? "new",
                        lastSyncedAt: input.lastSyncedAt ?? sql`now()`,
                    })

                await afterTx(async () =>
                    bus.publish(Resource.Bus, Events.AccountUpdated, { userID, steamID: input.id })
                );

                return input.id
            }),
    );

    export const update = fn(
        Info
            .extend({
                useUser: z.boolean(),
            })
            .partial({
                useUser: true,
                userID: true,
                status: true,
                lastSyncedAt: true,
                avatarHash: true,
                realName: true,
                limitations: true,
                accountStatus: true,
                name: true,
                memberSince: true,
                profileUrl: true,
            }),
        async (input) => {
            useTransaction(async (tx) => {
                const userID = typeof input.userID === "string" ? input.userID : input.useUser ? Actor.userID() : undefined;
                await tx
                    .update(steamTable)
                    .set({
                        ...input,
                        userID,
                        lastSyncedAt: input.lastSyncedAt ?? sql`now()`,
                    })
                    .where(eq(steamTable.id, input.id));

                await afterTx(async () =>
                    bus.publish(Resource.Bus, Events.AccountCreated, { userID: userID ?? null, steamID: input.id })
                );
            })
        }
    )

    export const fromUserID = fn(
        z.string().min(1),
        (userID) =>
            useTransaction((tx) =>
                tx
                    .select()
                    .from(steamTable)
                    .where(and(eq(steamTable.userID, userID), isNull(steamTable.timeDeleted)))
                    .orderBy(desc(steamTable.timeCreated))
                    .execute()
                    .then((rows) => rows.map(serialize))
            )
    )

    export const fromSteamID = fn(
        z.bigint(),
        (steamID) =>
            useTransaction((tx) =>
                tx
                    .select()
                    .from(steamTable)
                    .where(and(eq(steamTable.id, steamID), isNull(steamTable.timeDeleted)))
                    .orderBy(desc(steamTable.timeCreated))
                    .execute()
                    .then((rows) => rows.map(serialize))
            )
    )

    export const list = () =>
        useTransaction((tx) =>
            tx
                .select()
                .from(steamTable)
                .where(and(eq(steamTable.userID, Actor.userID()), isNull(steamTable.timeDeleted)))
                .orderBy(desc(steamTable.timeCreated))
                .execute()
                .then((rows) => rows.map(serialize))
        )

    export function serialize(
        input: typeof steamTable.$inferSelect,
    ): z.infer<typeof Info> {
        return {
            id: input.id,
            name: input.name,
            userID: input.userID,
            status: input.status,
            realName: input.realName,
            avatarHash: input.avatarHash,
            limitations: input.limitations,
            memberSince: input.memberSince,
            accountStatus: input.accountStatus,
            lastSyncedAt: input.lastSyncedAt,
            profileUrl: `https://steamcommunity.com/id/${input.profileUrl}`,
        };
    }

}