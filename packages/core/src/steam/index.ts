import { z } from "zod";
import { fn } from "../utils";
import { Examples } from "../examples";
import { eq, and, isNull } from "../drizzle";
import { useUser, useUserID } from "../actor";
import { createSelectSchema } from "drizzle-zod";
import { steamTable, steamCredentialsTable } from "./steam.sql";
import { createTransaction, useTransaction } from "../drizzle/transaction";


export namespace Steam {
    export const Info = z
        .object({
            avatarHash: z.string().openapi({
                description: "The steam avatar hash that this account owns",
                example: Examples.Steam.avatarHash
            }),
            steamID: z.bigint().openapi({
                description: "The Steam ID this Steam account",
                example: Examples.Steam.steamID
            }),
            profileUrl: z.string().url().openapi({
                description: "The steam community url of this account",
                example: Examples.Steam.profileUrl
            }),
            realName: z.string().openapi({
                description: "The real name behind of this Steam account",
                example: Examples.Steam.realName
            }),
            userID: z.string().nullable().openapi({
                description: "The unique id of the user who owns this steam account",
                example: Examples.Steam.userID
            }),
            personaName: z.string().openapi({
                description: "The persona name used by this account",
                example: Examples.Steam.personaName
            }),
        })
        .openapi({
            ref: "Steam",
            description: "Represents a steam user's information stored on Nestri",
            example: Examples.Steam,
        });

    export const CredentialInfo = createSelectSchema(steamCredentialsTable)
        .omit({ timeCreated: true, timeDeleted: true, timeUpdated: true })
        .extend({
            accessToken: z.string(),
            cookies: z.string().array()
        })
        .openapi({
            ref: "Steam Credential",
            description: "Represents a steam user's credentials stored on Nestri",
            example: Examples.Credential,
        });

    export type Info = z.infer<typeof Info>;
    export type CredentialInfo = z.infer<typeof CredentialInfo>;

    export const create = fn(
        Info
            .extend({
                useUser: z.boolean()
            })
            .partial({
                useUser: true
            }),
        (input) =>
            createTransaction(async (tx) => {
                await tx
                    .insert(steamTable)
                    .values({
                        userID: typeof input.userID === "string" ? input.userID : input.useUser ? useUser().userID : input.userID,
                        profileUrl: input.profileUrl,
                        avatarHash: input.avatarHash,
                        steamID: input.steamID,
                        realName: input.realName,
                        personaName: input.personaName
                    })
                    .onConflictDoNothing({ target: [steamTable.steamID, steamTable.userID] })
                return input.steamID
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

    export const createCredential = fn(
        CredentialInfo
            //Cookies and AccessToken cannot be persisted, they expire within 24 hours
            .omit({ cookies: true, accessToken: true }),
        (input) =>
            createTransaction(async (tx) => {
                await tx
                    .insert(steamCredentialsTable)
                    .values({
                        steamID: input.steamID,
                        username: input.username,
                        refreshToken: input.refreshToken,
                    })
                return input.steamID
            }),
    );

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
            userID: input.userID,
            profileUrl: input.profileUrl,
            avatarHash: input.avatarHash,
            steamID: input.steamID,
            realName: input.realName,
            personaName: input.personaName
        };
    }

}