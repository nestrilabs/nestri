import { z } from "zod";
import { Common } from "../common";
import { Examples } from "../examples";
import { createID, fn } from "../utils";
import { eq, and, isNull } from "../drizzle";
import { useUser, useUserID } from "../actor";
import { steamTable, steamCredentialsTable } from "./steam.sql";
import { createTransaction, useTransaction } from "../drizzle/transaction";

export namespace Steam {
    export const Credential = z.object({
        id: z.string().openapi({
            description: Common.IdDescription,
            example: Examples.Credential.id,
        }),
        accessToken: z.string().openapi({
            description: "The accessToken to login to a user's Steam account",
            example: Examples.Credential.accessToken
        }),
        refreshToken: z.string().openapi({
            description: "The refreshToken to login to a user's Steam account",
            example: Examples.Credential.refreshToken
        }),
        steamID: z.bigint().openapi({
            description: "The steamID to a user's Steam account",
            example: Examples.Credential.steamID
        }),
        cookies: z.string().array().openapi({
            description: "An array of cookies we can use to authenticate with Steam, and query the API",
            example: Examples.Credential.cookies
        }),
        username: z.string().openapi({
            description: "The username used to login to a user's Steam account",
            example: Examples.Credential.username
        }),
    })
        .openapi({
            ref: "Steam Credential",
            description: "Represents a steam user's credentials stored on Nestri",
            example: Examples.Credential,
        });

    export const Info = z
        .object({
            id: z.string().openapi({
                description: Common.IdDescription,
                example: Examples.Steam.id,
            }),
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

    export type Info = z.infer<typeof Info>;
    export type Credential = z.infer<typeof Credential>;

    export const create = fn(
        Info
            .partial({
                id: true,
            })
            .extend({
                useUser: z.boolean()
            }),
        (input) =>
            createTransaction(async (tx) => {
                const id = input.id ?? createID("steam");
                await tx.insert(steamTable).values({
                    id,
                    userID: typeof input.userID === "string" ? input.userID : input.useUser ? useUser().userID : input.userID,
                    profileUrl: input.profileUrl,
                    avatarHash: input.avatarHash,
                    steamID: input.steamID,
                    realName: input.realName,
                    personaName: input.personaName
                })
                return id;
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
        Credential
            .partial({
                id: true,
            })
            .omit({ cookies: true, accessToken: true }),
        (input) =>
            createTransaction(async (tx) => {
                const id = input.id ?? createID("credential");
                await tx.insert(steamCredentialsTable).values({
                    id,
                    steamID: input.steamID,
                    username: input.username,
                    refreshToken: input.refreshToken,
                })
                return id;
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
            id: input.id,
            // TODO: Do some leftJoin shenanigans
            userID: input.userID,
            profileUrl: input.profileUrl,
            avatarHash: input.avatarHash,
            steamID: input.steamID,
            realName: input.realName,
            personaName: input.personaName
        };
    }

}