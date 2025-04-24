import { z } from "zod";
import { Team } from "../team";
import { bus } from "sst/aws/bus";
import { Common } from "../common";
import { Polar } from "../polar/index";
import { createID, fn } from "../utils";
import { userTable } from "./user.sql";
import { createEvent } from "../event";
import { Examples } from "../examples";
import { Resource } from "sst/resource";
import { teamTable } from "../team/team.sql";
import { steamTable } from "../steam/steam.sql";
import { assertActor, withActor } from "../actor";
import { memberTable } from "../member/member.sql";
import { ErrorCodes, VisibleError } from "../error";
import { and, eq, isNull, asc, sql } from "../drizzle";
import { subscriptionTable } from "../subscription/subscription.sql";
import { afterTx, createTransaction, useTransaction } from "../drizzle/transaction";

export namespace User {
    const MAX_ATTEMPTS = 50;

    export const BasicInfo = z
        .object({
            id: z.string().openapi({
                description: Common.IdDescription,
                example: Examples.User.id,
            }),
            name: z.string().openapi({
                description: "The user's unique username",
                example: Examples.User.name,
            }),
            polarCustomerID: z.string().or(z.null()).openapi({
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

    export type BasicInfo = z.infer<typeof BasicInfo>;
    // export type FullInfo = z.infer<typeof FullInfo>;

    export const Events = {
        Created: createEvent(
            "user.created",
            z.object({
                userID: BasicInfo.shape.id,
            }),
        ),
        Updated: createEvent(
            "user.updated",
            z.object({
                userID: BasicInfo.shape.id,
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
                    .from(userTable)
                    .where(and(eq(userTable.name, username), eq(userTable.discriminator, Number(discriminator))))
            )

            if (users.length === 0) {
                return discriminator;
            }
        }

        return null;
    })

    export class UserExistsError extends VisibleError {
        constructor() {
            super(
                "already_exists",
                ErrorCodes.Validation.ALREADY_EXISTS,
                "User discriminator and name could already exists"
            );
        }
    }

    export const create = fn(
        BasicInfo.omit({
            polarCustomerID: true,
            discriminator: true,
        }).partial({
            avatarUrl: true,
            id: true
        }),
        async (input) => {
            const userID = createID("user")

            const customer = await Polar.fromUserEmail(input.email)

            const name = sanitizeUsername(input.name);

            // Generate a random available discriminator
            const discriminator = generateDiscriminator()

            const id = input.id ?? userID;

            await createTransaction(async (tx) => {
                const result = await tx
                    .insert(userTable).values({
                        id,
                        name,
                        avatarUrl: input.avatarUrl,
                        email: input.email,
                        discriminator: Number(discriminator),
                        polarCustomerID: customer?.id
                    })
                    .onConflictDoNothing({
                        target: [userTable.discriminator, userTable.name]
                    })

                if (result.count === 0) {
                    const discriminator = await findAvailableDiscriminator(name);

                    if (!discriminator) {
                        console.error("No available discriminators for this username ")
                        return null
                    }

                    const result2 = await tx
                        .insert(userTable).values({
                            id,
                            name,
                            email: input.email,
                            avatarUrl: input.avatarUrl,
                            discriminator: Number(discriminator),
                            polarCustomerID: customer?.id
                        })
                        .onConflictDoNothing({
                            target: [userTable.discriminator, userTable.name]
                        })

                    if (result2.length === 0) throw new UserExistsError()
                }

                await afterTx(() =>
                    withActor({
                        type: "user",
                        properties: {
                            userID: id,
                            email: input.email
                        },
                    },
                        async () => bus.publish(Resource.Bus, Events.Created, { userID: id }),
                    )
                );
            })

            return id;
        })

    export const fromEmail = fn(
        BasicInfo.shape.email,
        async (email) =>
            useTransaction(async (tx) =>
                tx
                    .select()
                    .from(userTable)
                    .where(and(eq(userTable.email, email), isNull(userTable.timeDeleted)))
                    .orderBy(asc(userTable.timeCreated))
                    .execute()
                    .then(rows => rows.map(serializeBasic).at(0))
            )
    )

    export const fromID = fn(
        BasicInfo.shape.id,
        (id) =>
            useTransaction(async (tx) =>
                tx
                    .select()
                    .from(userTable)
                    .where(and(eq(userTable.id, id), isNull(userTable.timeDeleted), isNull(steamTable.timeDeleted)))
                    .orderBy(asc(userTable.timeCreated))
                    .execute()
                    .then(rows => rows.map(serializeBasic).at(0))
            ),
    )

    export const remove = fn(
        BasicInfo.shape.id,
        (id) =>
            useTransaction(async (tx) => {
                await tx
                    .update(userTable)
                    .set({
                        timeDeleted: sql`now()`,
                    })
                    .where(and(eq(userTable.id, id)))
                    .execute();
                return id;
            }),
    );

    export function serializeBasic(
        input: typeof userTable.$inferSelect
    ): z.infer<typeof BasicInfo> {
        return {
            id: input.id,
            name: input.name,
            email: input.email,
            avatarUrl: input.avatarUrl,
            discriminator: input.discriminator,
            polarCustomerID: input.polarCustomerID,
        }
    }

    /**
     * Retrieves the list of teams that the current user belongs to.
     *
     * @returns An array of team information objects representing the user's active team memberships.
     *
     * @remark Only teams and memberships that have not been deleted are included in the result.
     */
    export function teams() {
        const actor = assertActor("user");
        return useTransaction(async (tx) =>
            tx
                .select()
                .from(teamTable)
                .leftJoin(subscriptionTable, eq(subscriptionTable.teamID, teamTable.id))
                .innerJoin(memberTable, eq(memberTable.teamID, teamTable.id))
                .where(
                    and(
                        eq(memberTable.email, actor.properties.email),
                        isNull(memberTable.timeDeleted),
                        isNull(teamTable.timeDeleted),
                    ),
                )
                .execute()
                .then((rows) => Team.serializeFull(rows))
        )
    }
}