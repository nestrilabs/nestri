import { z } from "zod";
import { Examples } from "../examples";
import { useUser, useUserID } from "../actor";
import { decrypt, encrypt, fn } from "../utils";
import { createSelectSchema } from "drizzle-zod";
import { eq, and, isNull, sql } from "../drizzle";
import { steamTable, steamCredentialsTable } from "./steam.sql";
import { createTransaction, useTransaction } from "../drizzle/transaction";

export namespace Steam {
    export const Info = z
        .object({
            avatarHash: z.string().openapi({
                description: "The steam avatar hash that this account owns",
                example: Examples.SteamAccount.avatarHash
            }),
            id: z.bigint().openapi({
                description: "The Steam ID this Steam account",
                example: Examples.SteamAccount.id
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

    export const create = fn(
        Info
            .extend({
                useUser: z.boolean(),
                userID: z.string().nullable()
            })
            .partial({
                useUser: true
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

                if (accounts.length > 0) return //Steam account already exists

                await tx
                    .insert(steamTable)
                    .values({
                        id: input.id,
                        userID: typeof input.userID === "string" ? input.userID : input.useUser ? useUser().userID : input.userID,
                        profileUrl: input.profileUrl,
                        lastSyncedAt: sql`now()`,
                        avatarHash: input.avatarHash,
                        realName: input.realName,
                        personaName: input.personaName
                    })
                    .onConflictDoUpdate({
                        target: steamTable.id,
                        set: {
                            realName: sql`excluded.real_name`,
                            lastSyncedAt: sql`excluded.last_synced_at`,
                            personaName: sql`excluded.persona_name`,
                            avatarHash: sql`excluded.avatar_hash`,
                            userID: sql`excluded.user_id`,
                            profileUrl: sql`excluded.profile_url`
                        }
                    })

                return input.id
            }),
    );

    export const fromUserID = fn(
        z.string().min(1),
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

                return { ...credential, refreshToken: decrypt(credential.refreshToken) };
            })
    );

    export function serialize(
        input: typeof steamTable.$inferSelect,
    ): z.infer<typeof Info> {
        return {
            id: input.id,
            userID: input.userID,
            realName: input.realName,
            profileUrl: input.profileUrl,
            avatarHash: input.avatarHash,
            personaName: input.personaName,
            lastSyncedAt: input.lastSyncedAt,
        };
    }

}