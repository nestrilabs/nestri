import { z } from "zod";
import { Common } from "../common";
import { createEvent } from "../event";
import { Polar } from "../polar/index";
import { createID, fn } from "../utils";
import { userTable } from "./user.sql";
import { Examples } from "../examples";
import { and, eq, isNull, asc } from "drizzle-orm";
import { ErrorCodes, VisibleError } from "../error";
import { createTransaction, useTransaction } from "../drizzle/transaction";

export namespace User {
    export const Info = z
        .object({
            id: z.string().openapi({
                description: Common.IdDescription,
                example: Examples.User.id,
            }),
            name: z.string().regex(/^[a-zA-Z ]{1,32}$/, "Use a friendly name.").openapi({
                description: "The name of this account",
                example: Examples.User.name
            }),
            polarCustomerID: z.string().nullable().openapi({
                description: "Associated Polar.sh customer identifier",
                example: Examples.User.polarCustomerID,
            }),
            avatarUrl: z.string().url().nullable().openapi({
                description: "The url to the profile picture",
                example: Examples.User.avatarUrl
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
                `A user with this email ${username} already exists`
            );
        }
    }

    export const Events = {
        Created: createEvent(
            "user.created",
            z.object({
                userID: Info.shape.id,
            }),
        ),
    };

    export const create = fn(
        Info
            .omit({
                lastLogin: true,
                polarCustomerID: true,
            }).partial({
                avatarUrl: true,
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
                        avatarUrl: input.avatarUrl,
                        email: input.email,
                        name: input.name,
                        polarCustomerID: customer?.id,
                        lastLogin: Common.utc()
                    })
                    .onConflictDoNothing({
                        target: [userTable.email]
                    })

                if (result.count === 0) {
                    throw new UserExistsError(input.email)
                }
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
                    .where(
                        and(
                            eq(userTable.email, email),
                            isNull(userTable.timeDeleted)
                        )
                    )
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
                    .where(
                        and(
                            eq(userTable.id, id),
                            isNull(userTable.timeDeleted)
                        )
                    )
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
                        timeDeleted: Common.utc(),
                    })
                    .where(and(eq(userTable.id, id)))
                    .execute();
                return id;
            }),
    );

    export const acknowledgeLogin = fn(
        Info.shape.id,
        (id) =>
            useTransaction(async (tx) =>
                tx
                    .update(userTable)
                    .set({
                        lastLogin: Common.utc(),
                    })
                    .where(and(eq(userTable.id, id)))
                    .execute()

            ),
    )

    export function serialize(
        input: typeof userTable.$inferSelect
    ): z.infer<typeof Info> {
        return {
            id: input.id,
            name: input.name,
            email: input.email,
            avatarUrl: input.avatarUrl,
            lastLogin: input.lastLogin,
            polarCustomerID: input.polarCustomerID,
        }
    }
}