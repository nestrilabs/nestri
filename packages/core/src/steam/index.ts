import { z } from "zod";
import { fn } from "../utils";
import { Resource } from "sst";
import { Actor } from "../actor";
import { bus } from "sst/aws/bus";
import { Common } from "../common";
import { createEvent } from "../event";
import { Examples } from "../examples";
import { eq, and, isNull, desc } from "drizzle-orm";
import { steamTable, StatusEnum, Limitations } from "./steam.sql";
import { afterTx, createTransaction, useTransaction } from "../drizzle/transaction";
import { teamTable } from "../team/team.sql";

export namespace Steam {
    export const Info = z
        .object({
            id: z.string().openapi({
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
            userID: z.string().nullable().openapi({
                description: "The user id of which account owns this steam account",
                example: Examples.SteamAccount.userID
            }),
            profileUrl: z.string().nullable().openapi({
                description: "The steam community url of this account",
                example: Examples.SteamAccount.profileUrl
            }),
            username: z.string()
                .regex(/^[a-z0-9]{1,32}$/, "The Steam username is not slug friendly")
                .nullable()
                .openapi({
                    description: "The unique username of this account",
                    example: Examples.SteamAccount.username
                })
                .default("unknown"),
            realName: z.string().nullable().openapi({
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
            steamMemberSince: z.date().openapi({
                description: "When this Steam community account was created",
                example: Examples.SteamAccount.steamMemberSince
            })
        })
        .openapi({
            ref: "Steam",
            description: "Represents a steam user's information stored on Nestri",
            example: Examples.SteamAccount,
        });

    export type Info = z.infer<typeof Info>;

    export const Events = {
        Created: createEvent(
            "steam_account.created",
            z.object({
                steamID: Info.shape.id,
                userID: Info.shape.userID
            }),
        ),
        Updated: createEvent(
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
                        userID,
                        id: input.id,
                        name: input.name,
                        realName: input.realName,
                        profileUrl: input.profileUrl,
                        avatarHash: input.avatarHash,
                        limitations: input.limitations,
                        status: input.status ?? "offline",
                        username: input.username ?? "unknown",
                        steamMemberSince: input.steamMemberSince,
                        lastSyncedAt: input.lastSyncedAt ?? Common.utc(),
                    })

                // await afterTx(async () =>
                //     bus.publish(Resource.Bus, Events.Created, { userID, steamID: input.id })
                // );

                return input.id
            }),
    );

    export const updateOwner = fn(
        z
            .object({
                userID: z.string(),
                steamID: z.string()
            })
            .partial({
                userID: true
            }),
        (input) =>
            useTransaction(async (tx) => {
                const userID = input.userID ?? Actor.userID()
                await tx
                    .update(steamTable)
                    .set({
                        userID
                    })
                    .where(eq(steamTable.id, input.steamID));
            })
    )

    // TODO: This needs to be handled better, as it has the potential to turn unnecessary fields into `null`
    // export const update = fn(
    //     Info
    //         .extend({
    //             useUser: z.boolean(),
    //         })
    //         .partial({
    //             useUser: true,
    //             userID: true,
    //             status: true,
    //             name: true,
    //             lastSyncedAt: true,
    //             avatarHash: true,
    //             username: true,
    //             realName: true,
    //             limitations: true,
    //             profileUrl: true,
    //             steamMemberSince: true,
    //         }),
    //     async (input) =>
    //         useTransaction(async (tx) => {
    //             const userID = typeof input.userID === "string" ? input.userID : input.useUser ? Actor.userID() : undefined;
    //             await tx
    //                 .update(steamTable)
    //                 .set({
    //                     userID,
    //                     id: input.id,
    //                     name: input.name,
    //                     realName: input.realName,
    //                     profileUrl: input.profileUrl,
    //                     avatarHash: input.avatarHash,
    //                     limitations: input.limitations,
    //                     status: input.status ?? "offline",
    //                     username: input.username ?? "unknown",
    //                     steamMemberSince: input.steamMemberSince,
    //                     lastSyncedAt: input.lastSyncedAt ?? Common.utc(),
    //                 })
    //                 .where(eq(steamTable.id, input.id));

    //             await afterTx(async () =>
    //                 bus.publish(Resource.Bus, Events.Updated, { userID: userID ?? null, steamID: input.id })
    //             );
    //         })
    // )

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
        z.string(),
        (steamID) =>
            useTransaction((tx) =>
                tx
                    .select()
                    .from(steamTable)
                    .where(and(eq(steamTable.id, steamID), isNull(steamTable.timeDeleted)))
                    .orderBy(desc(steamTable.timeCreated))
                    .execute()
                    .then((rows) => rows.map(serialize).at(0))
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
            username: input.username,
            realName: input.realName,
            avatarHash: input.avatarHash,
            limitations: input.limitations,
            lastSyncedAt: input.lastSyncedAt,
            steamMemberSince: input.steamMemberSince,
            profileUrl: input.profileUrl ? `https://steamcommunity.com/id/${input.profileUrl}` : null,
        };
    }

}