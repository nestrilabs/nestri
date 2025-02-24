import { z } from "zod";
import { Polar } from "../polar";
import { user } from "./user.sql";
import { Common } from "../common";
import { createID, fn } from "../utils";
import { createEvent } from "../event";
import { Examples } from "../examples";
import { and, db, eq, isNull, asc } from "../drizzle";
import { afterTx, createTransaction, useTransaction } from "../drizzle/transaction";
import { bus } from "sst/aws/bus";
import { Resource } from "sst/resource";
import { withActor } from "../actor";


export module User {
    const MAX_ATTEMPTS = 50;

    export const Info = z
        .object({
            id: z.string().openapi({
                description: Common.IdDescription,
                example: Examples.User.id,
            }),
            name: z.string().openapi({
                description: "The user's unique username",
                example: Examples.User.name,
            }),
            polarCustomerID: z.string().openapi({
                description: "The polar customer id for this user",
                example: Examples.User.polarCustomerID,
            }),
            email: z.string().openapi({
                description: "The email address of this user",
                example: Examples.User.email,
            }),
            avatarUrl: z.string().or(z.null()).openapi({
                description: "The url to the profile picture.",
                example: Examples.User.name,
            }),
            discriminator: z.string().or(z.number()).openapi({
                description: "The (number) discriminator for this user",
                example: Examples.User.discriminator,
            }),
        })
        .openapi({
            ref: "User",
            description: "Represents a user on Nestri",
            example: Examples.User,
        });

    export type Info = z.infer<typeof Info>;

    export const Events = {
        Created: createEvent(
            "user.created",
            z.object({
                userID: Info.shape.id,
            }),
        ),
        Updated: createEvent(
            "user.updated",
            z.object({
                userID: Info.shape.id,
            }),
        ),
    };

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

    export const findAvailableDiscriminator = fn(z.string(), async (input) => {
        const username = sanitizeUsername(input);

        for (let i = 0; i < MAX_ATTEMPTS; i++) {
            const discriminator = generateDiscriminator();

            const users = await useTransaction(async (tx) =>
                tx
                    .select()
                    .from(user)
                    .where(and(eq(user.name, username), eq(user.discriminator, Number(discriminator))))
            )

            if (users.length === 0) {
                return discriminator;
            }
        }

        return null;
    })

    export const create = fn(Info.omit({ polarCustomerID: true, discriminator: true }).partial({ avatarUrl: true, id: true }), async (input) => {
        const userID = createID("user")

        const customer = await Polar.client.customers.create({
            email: input.email,
            metadata: {
                userID,
            },
        });

        const name = sanitizeUsername(input.name);

        // Generate a random available discriminator
        const discriminator = await findAvailableDiscriminator(name);

        if (!discriminator) {
            console.error("No available discriminators for this username ")
            return null
        }

        createTransaction(async (tx) => {
            const id = input.id ?? userID;
            await tx.insert(user).values({
                id,
                name: input.name,
                avatarUrl: input.avatarUrl,
                polarCustomerID: customer!.id,
                email: input.email ?? customer?.email,
                discriminator: Number(discriminator),
            });
            await afterTx(() =>
                withActor({
                    type: "user",
                    properties: {
                        userID,
                        email: input.email
                    },
                },
                    async () => bus.publish(Resource.Bus, Events.Created, { userID: id }),
                )
            );
        })

        return userID;
    })

    export const fromEmail = fn(z.string(), async (email) =>
        useTransaction(async (tx) =>
            tx
                .select()
                .from(user)
                .where(and(eq(user.email, email), isNull(user.timeDeleted)))
                .orderBy(asc(user.timeCreated))
                .then((rows) => rows.map(serialize)),
        ),
    )

    function serialize(
        input: typeof user.$inferSelect,
    ): z.infer<typeof Info> {
        return {
            id: input.id,
            name: input.name,
            email: input.email,
            avatarUrl: input.avatarUrl,
            discriminator: input.discriminator,
            polarCustomerID: input.polarCustomerID,
        };
    }

}