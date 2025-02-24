import { z } from "zod"
import { fn } from "../utils";
import { Common } from "../common";
import { Examples } from "../examples";
import databaseClient from "../database";
import { groupBy, map, pipe, values } from "remeda"
import { id as createID, } from "@instantdb/admin";
import { useCurrentUser } from "../actor";

export const userStatus = z.enum([
    "active", //online and playing a game
    "idle", //online and not playing
    "offline",
]);

export module Profiles {
    const MAX_ATTEMPTS = 50;

    export const Info = z
        .object({
            id: z.string().openapi({
                description: Common.IdDescription,
                example: Examples.Machine.id,
            }),
            username: z.string().openapi({
                description: "The user's unique username",
                example: Examples.Profile.username,
            }),
            avatarUrl: z.string().or(z.undefined()).openapi({
                description: "The url to the profile picture.",
                example: Examples.Profile.username,
            }),
            status: userStatus.openapi({
                description: "Whether the user is active, idle or offline",
                example: Examples.Profile.status
            }),
            discriminator: z.string().or(z.number()).openapi({
                description: "The number discriminator for each username",
                example: Examples.Profile.discriminator,
            }),
            createdAt: z.string().or(z.number()).openapi({
                description: "The time when this profile was first created",
                example: Examples.Profile.createdAt,
            }),
            updatedAt: z.string().or(z.number()).openapi({
                description: "The time when this profile was last edited",
                example: Examples.Profile.updatedAt,
            })
        })
        .openapi({
            ref: "Profile",
            description: "Represents a profile of a user on Nestri",
            example: Examples.Profile,
        });

    export type Info = z.infer<typeof Info>;
    export type userStatus = z.infer<typeof userStatus>;

    export const sanitizeUsername = (username: string): string => {
        // Remove spaces and numbers
        return username.replace(/[\s0-9]/g, '');
    };

    export const generateDiscriminator = (): string => {
        return Math.floor(Math.random() * 100).toString().padStart(2, '0');
    };

    export const isValidDiscriminator = (discriminator: string): boolean => {
        return /^\d{2}$/.test(discriminator);
    };

    export const fromUsername = fn(z.string(), async (input) => {
        const sanitizedUsername = sanitizeUsername(input);

        const db = databaseClient()

        const query = {
            profiles: {
                $: {
                    where: {
                        username: sanitizedUsername,
                    }
                }
            }
        }

        const res = await db.query(query)

        const profiles = res.profiles

        if (!profiles || profiles.length == 0) {

            return null
        }

        return pipe(
            profiles,
            groupBy(x => x.id),
            values(),
            map((group): Info => ({
                id: group[0].id,
                username: group[0].username,
                createdAt: group[0].createdAt,
                discriminator: group[0].discriminator,
                updatedAt: group[0].updatedAt,
                status: group[0].status as userStatus
            }))
        )
    })

    export const findAvailableDiscriminator = fn(z.string(), async (input) => {
        const db = databaseClient()
        const username = sanitizeUsername(input);

        for (let i = 0; i < MAX_ATTEMPTS; i++) {
            const discriminator = generateDiscriminator();
            const query = {
                profiles: {
                    $: {
                        where: {
                            username,
                            discriminator
                        }
                    }
                }
            }
            const res = await db.query(query)
            const profiles = res.profiles
            if (profiles.length === 0) {
                return discriminator;
            }
        }
        return null; // No available discriminators

    })

    export const create = fn(z.object({ username: z.string(), customDiscriminator: z.string().optional(), avatarUrl: z.string().optional(), owner: z.string() }), async (input) => {
        const username = sanitizeUsername(input.username);

        const db = databaseClient()
        const id = createID()
        const now = new Date().toISOString()

        let discriminator: string | null;
        if (input.customDiscriminator) {
            if (!isValidDiscriminator(input.customDiscriminator)) {
                console.error('Invalid discriminator format')
                return null
                // throw new Error('Invalid discriminator format');
            }

            const query = {
                profiles: {
                    $: {
                        where: {
                            username,
                            discriminator: input.customDiscriminator
                        }
                    }
                }
            }

            const res = await db.query(query)
            const profiles = res.profiles
            if (profiles.length != 0) {
                console.error("Username and discriminator combination already taken ")
                return null
                // throw new Error('Username and discriminator combination already taken');
            }

            discriminator = input.customDiscriminator
        } else {
            // Generate a random available discriminator
            discriminator = await findAvailableDiscriminator(username);

            if (!discriminator) {
                console.error("No available discriminators for this username ")
                return null
                // throw new Error('No available discriminators for this username');
            }
        }

        return await db.transact(
            db.tx.profiles[id]!.update({
                username,
                avatarUrl: input.avatarUrl,
                createdAt: now,
                updatedAt: now,
                discriminator,
                status: "idle"
            }).link({ owner: input.owner })
        )
    })

    export const getFullUsername = async (username: string) => {
        const db = databaseClient()

        const query = {
            profiles: {
                $: {
                    where: {
                        username,
                    }
                }
            }
        }
        const res = await db.query(query)
        const profiles = res.profiles

        if (!profiles || profiles.length === 0) {
            console.error('User not found')
            return null
            // throw new Error('User not found');
        }

        return `${profiles[0]?.username}#${profiles[0]?.discriminator}`;
    }

    export const fromOwnerID = async (ownerID: string) => {
        try {

            const db = databaseClient()

            const query = {
                profiles: {
                    $: {
                        where: {
                            owner: ownerID
                        }
                    },
                }
            }
            const res = await db.query(query)

            const profiles = res.profiles

            if (!profiles || profiles.length === 0) {
                throw new Error("No profiles were found");
            }

            const profile = pipe(
                profiles,
                groupBy(x => x.id),
                values(),
                map((group): Info => ({
                    id: group[0].id,
                    username: group[0].username,
                    createdAt: group[0].createdAt,
                    updatedAt: group[0].updatedAt,
                    avatarUrl: group[0].avatarUrl,
                    discriminator: group[0].discriminator,
                    status: group[0].status as userStatus
                }))
            )

            return profile[0]
        } catch (error) {
            console.log("user fromOwnerID", error)
            return null
        }
    }

    export const fromID = async (id: string) => {
        try {

            const db = databaseClient()

            const query = {
                profiles: {
                    $: {
                        where: {
                            id
                        }
                    },
                }
            }
            const res = await db.query(query)

            const profiles = res.profiles

            if (!profiles || profiles.length === 0) {
                throw new Error("No profiles were found");
            }

            const profile = pipe(
                profiles,
                groupBy(x => x.id),
                values(),
                map((group): Info => ({
                    id: group[0].id,
                    username: group[0].username,
                    createdAt: group[0].createdAt,
                    updatedAt: group[0].updatedAt,
                    avatarUrl: group[0].avatarUrl,
                    discriminator: group[0].discriminator,
                    status: group[0].status as userStatus
                }))
            )

            return profile[0]
        } catch (error) {
            console.log("user fromID", error)
            return null
        }
    }

    export const fromIDToOwner = async (id: string) => {
        try {

            const db = databaseClient()

            const query = {
                profiles: {
                    $: {
                        where: {
                            id
                        }
                    },
                }
            }
            const res = await db.query(query)

            const profiles = res.profiles as any

            if (!profiles || profiles.length === 0) {
                throw new Error("No profiles were found");
            }

            return profiles[0]!.owner as string
        } catch (error) {
            console.log("user fromID", error)
            return null
        }
    }
    export const getCurrentProfile = async () => {
        const user = useCurrentUser()
        const currentProfile = await fromOwnerID(user.id);

        return currentProfile
    }

    export const setStatus = fn(userStatus, async (status) => {
        try {
            const user = useCurrentUser()
            const db = databaseClient()

            const now = new Date().toISOString()

            await db.transact(
                db.tx.profiles[user.id]!.update({
                    status,
                    updatedAt: now
                })
            )
        } catch (error) {
            console.log("user setStatus error", error)
            return null
        }
    })

    export const list = async () => {
        try {
            const db = databaseClient()
            // const ago = new Date(Date.now() - (60 * 1000 * 30)).toISOString()
            const ago = new Date(Date.now() - (24 * 60 * 60 * 1000)).toISOString()

            const query = {
                profiles: {
                    $: {
                        limit: 10,
                        where: {
                            updatedAt: { $gt: ago },
                        },
                        order: {
                            updatedAt: "desc" as const,
                        },
                    }
                }
            }

            const res = await db.query(query)

            const profiles = res.profiles

            if (!profiles || profiles.length === 0) {
                throw new Error("No profiles were found");

            }

            const result = pipe(
                profiles,
                groupBy(x => x.id),
                values(),
                map((group): Info => ({
                    id: group[0].id,
                    username: group[0].username,
                    createdAt: group[0].createdAt,
                    updatedAt: group[0].updatedAt,
                    avatarUrl: group[0].avatarUrl,
                    discriminator: group[0].discriminator,
                    status: group[0].status as userStatus
                }))
            )

            return result

        } catch (error) {
            console.log("user list error", error)
            return null
        }
    }
}