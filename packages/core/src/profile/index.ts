import { z } from "zod"
import { fn } from "../utils";
import { Common } from "../common";
import { Examples } from "../examples";
import databaseClient from "../database";
import { groupBy, map, pipe, values } from "remeda"
import { id as createID } from "@instantdb/admin";

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
                updatedAt: group[0].updatedAt
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

        // if (!username || username.length < 2 || username.length > 32) {
        //     // throw new Error('Invalid username length');
        // }

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
                ownerID: input.owner,
                discriminator,
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

    export const getProfile = async (ownerID: string) => {

        const db = databaseClient()

        const query = {
            profiles: {
                $: {
                    where: {
                        ownerID
                    }
                },
            }
        }
        const res = await db.query(query)

        const profiles = res.profiles

        if (!profiles || profiles.length === 0) {
            return null
        }

        return profiles
    }
};