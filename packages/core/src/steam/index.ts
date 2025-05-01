import { z } from "zod";
import { Actor } from "../actor";
import { Common } from "../common";
import { Examples } from "../examples";
import { decrypt, encrypt, fn } from "../utils";
import { createSelectSchema } from "drizzle-zod";
import { eq, and, isNull, sql, desc } from "../drizzle";
import { afterTx, createTransaction, useTransaction } from "../drizzle/transaction";
import { steamTable, steamCredentialsTable, statusEnum } from "./steam.sql";
import { Resource } from "sst";
import { createEvent } from "../event";
import { bus } from "sst/aws/bus";

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
            status: z.enum(statusEnum.enumValues).openapi({
                description: "The status of this Steam account",
                example: Examples.SteamAccount.status
            }),
            userID: z.string().nullable().openapi({
                description: "The user id of which account owns this steam account",
                example: Examples.SteamAccount.userID
            }),
            profileUrl: z.string().url().openapi({
                description: "The steam community url of this account",
                example: Examples.SteamAccount.profileUrl
            }),
            realName: z.string().openapi({
                description: "The real name behind of this Steam account",
                example: Examples.SteamAccount.realName
            }),
            personaName: z.string().openapi({
                description: "The persona name used by this account",
                example: Examples.SteamAccount.personaName
            }),
            lastSyncedAt: z.date().openapi({
                description: "The last time this account was synced to Steam",
                example: Examples.SteamAccount.lastSyncedAt
            }),
        })
        .openapi({
            ref: "Steam",
            description: "Represents a steam user's information stored on Nestri",
            example: Examples.SteamAccount,
        });

    export const CredentialInfo = createSelectSchema(steamCredentialsTable)
        .omit({ timeCreated: true, timeDeleted: true, timeUpdated: true })
        .extend({
            accessToken: z.string(),
            cookies: z.string().array()
        })

    export type Info = z.infer<typeof Info>;
    export type CredentialInfo = z.infer<typeof CredentialInfo>;

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
        ),
        NewCredentials: createEvent(
            "new_credentials.added",
            z.object({
                steamID: Info.shape.id,
            }),
        ),
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
                        id: input.id,
                        status: input.status ?? "new",
                        userID,
                        profileUrl: input.profileUrl,
                        lastSyncedAt: input.lastSyncedAt ?? sql`now()`,
                        avatarHash: input.avatarHash,
                        realName: input.realName,
                        personaName: input.personaName
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
                personaName: true,
                profileUrl: true,
            }),
        async (input) => {
            useTransaction(async (tx) => {
                const userID = typeof input.userID === "string" ? input.userID : input.useUser ? Actor.userID() : undefined;
                await tx
                    .update(steamTable)
                    .set({
                        userID,
                        status: input.status,
                        profileUrl: input.profileUrl,
                        lastSyncedAt: input.lastSyncedAt ?? sql`now()`,
                        avatarHash: input.avatarHash,
                        personaName: input.personaName,
                        realName: input.realName,
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

    export const createCredential = fn(
        CredentialInfo
            .omit({ accessToken: true, cookies: true }),
        (input) =>
            createTransaction(async (tx) => {
                const encryptedToken = encrypt(input.refreshToken)
                await tx
                    .insert(steamCredentialsTable)
                    .values({
                        id: input.id,
                        username: input.username,
                        refreshToken: encryptedToken,
                    })
                await afterTx(async () =>
                    await bus.publish(Resource.Bus, Events.NewCredentials, { steamID: input.id })
                );
                return input.id
            }),
    );

    export const getCredentialByID = fn(
        CredentialInfo.shape.id,
        (steamID) =>
            useTransaction(async (tx) => {
                const credential = await tx
                    .select()
                    .from(steamCredentialsTable)
                    .where(and(
                        eq(steamCredentialsTable.id, steamID),
                        isNull(steamCredentialsTable.timeDeleted)
                    ))
                    .execute()
                    .then(rows => rows.at(0));

                if (!credential) return null;

                const { timeCreated, timeUpdated, timeDeleted, ...rest } = credential

                return { ...rest, refreshToken: decrypt(credential.refreshToken) };
            })
    );

    export function serialize(
        input: typeof steamTable.$inferSelect,
    ): z.infer<typeof Info> {
        return {
            id: input.id,
            userID: input.userID,
            status: input.status,
            realName: input.realName,
            profileUrl: input.profileUrl,
            avatarHash: input.avatarHash,
            personaName: input.personaName,
            lastSyncedAt: input.lastSyncedAt,
        };
    }

}