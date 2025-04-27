import { z } from "zod";
// import { Team } from "../team";
import { Common } from "../common";
import { Polar } from "../polar/index";
import { createID, fn } from "../utils";
import { userTable } from "./user.sql";
// import { assertActor } from "../actor";
import { Examples } from "../examples";
// import { teamTable } from "../team/team.sql";
// import { memberTable } from "../member/member.sql";
import { ErrorCodes, VisibleError } from "../error";
import { and, eq, isNull, asc, sql } from "../drizzle";
// import { subscriptionTable } from "../subscription/subscription.sql";
import { createTransaction, useTransaction } from "../drizzle/transaction";
import { useUserID } from "../actor";

export namespace User {
    export const Info = z
        .object({
            id: z.string().openapi({
                description: Common.IdDescription,
                example: Examples.User.id,
            }),
            username: z.string().regex(/^[a-z0-9\-]+$/, "Use a URL friendly name.").openapi({
                description: "URL-friendly unique username (lowercase alphanumeric with hyphens)",
                example: Examples.User.username
            }),
            polarCustomerID: z.string().nullable().openapi({
                description: "Associated Polar.sh customer identifier",
                example: Examples.User.polarCustomerID,
            }),
            email: z.string().openapi({
                description: "Primary email address for user notifications and authentication",
                example: Examples.User.email,
            }),
            lastLogin: z.date().openapi({
                description: "Timestamp of user's most recent authentication",
                example: Examples.User.lastLogin
            })
        })
        .openapi({
            ref: "User",
            description: "User account entity with core identification and authentication details",
            example: Examples.User,
        });

    export type Info = z.infer<typeof Info>;

    export class UserExistsError extends VisibleError {
        constructor(username: string) {
            super(
                "already_exists",
                ErrorCodes.Validation.ALREADY_EXISTS,
                `A user with username ${username} already exists`
            );
        }
    }

    export const create = fn(
        Info
            .omit({
                lastLogin:true,
                polarCustomerID: true,
            }).partial({
                id: true
            }),
        async (input) => {
            const userID = createID("user")

            const customer = await Polar.fromUserEmail(input.email)

            const id = input.id ?? userID;

            await createTransaction(async (tx) => {
                const result = await tx
                    .insert(userTable)
                    .values({
                        id,
                        email: input.email,
                        username: input.username,
                        polarCustomerID: customer?.id,
                        lastLogin: sql`now()`
                    })
                    .onConflictDoNothing({
                        target: [userTable.username]
                    })

                if (result.count === 0) {
                    throw new UserExistsError(input.username)
                }

                //FIXME: Implement a bus 
                // await afterTx(() =>
                //     withActor({
                //         type: "user",
                //         properties: {
                //             userID: id,
                //             email: input.email
                //         },
                //     },
                //         async () => bus.publish(Resource.Bus, Events.Created, { userID: id }),
                //     )
                // );
            })

            return id;
        })

    export const fromEmail = fn(
        Info.shape.email.min(1),
        async (email) =>
            useTransaction(async (tx) =>
                tx
                    .select()
                    .from(userTable)
                    .where(and(eq(userTable.email, email), isNull(userTable.timeDeleted)))
                    .orderBy(asc(userTable.timeCreated))
                    .execute()
                    .then(rows => rows.map(serialize).at(0))
            )
    )

    export const fromID = fn(
        Info.shape.id.min(1),
        (id) =>
            useTransaction(async (tx) =>
                tx
                    .select()
                    .from(userTable)
                    .where(and(eq(userTable.id, id), isNull(userTable.timeDeleted)))
                    .orderBy(asc(userTable.timeCreated))
                    .execute()
                    .then(rows => rows.map(serialize).at(0))
            ),
    )

    export const remove = fn(
        Info.shape.id.min(1),
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

    export const acknowledgeLogin = fn(
        z.void(),
        () =>
            useTransaction(async (tx) =>
                tx
                    .update(userTable)
                    .set({
                        lastLogin: sql`now()`,
                    })
                    .where(and(eq(userTable.id, useUserID())))
                    .execute()

            ),
    )

    export function serialize(
        input: typeof userTable.$inferSelect
    ): z.infer<typeof Info> {
        return {
            id: input.id,
            email: input.email,
            username: input.username,
            polarCustomerID: input.polarCustomerID,
            lastLogin: input.lastLogin
        }
    }
}