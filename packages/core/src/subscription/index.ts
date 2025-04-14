import { z } from "zod";
import { eq } from "../drizzle";
import { Common } from "../common";
import { Examples } from "../examples";
import { createID, fn } from "../utils";
import { createTransaction, useTransaction } from "../drizzle/transaction";
import { PlanType, Standing, subscriptionTable } from "./subscription.sql";
import { useTeam, useUserID } from "../actor";

export namespace Subscription {
    export const Info = z.object({
        id: z.string().openapi({
            description: Common.IdDescription,
            example: Examples.Subscription.id,
        }),
        polarSubscriptionID: z.string().nullable().or(z.undefined()).openapi({
            description: "The unique id of the plan this subscription is on",
            example: Examples.Subscription.polarSubscriptionID,
        }),
        teamID: z.string().openapi({
            description: "The unique id of the team this subscription is for",
            example: Examples.Subscription.teamID,
        }),
        userID: z.string().openapi({
            description: "The unique id of the user who is paying this subscription",
            example: Examples.Subscription.userID,
        }),
        polarProductID: z.string().nullable().or(z.undefined()).openapi({
            description: "The unique id of the product this subscription is for",
            example: Examples.Subscription.polarProductID,
        }),
        tokens: z.number().openapi({
            description: "The number of tokens this subscription has left",
            example: Examples.Subscription.tokens,
        }),
        planType: z.enum(PlanType).openapi({
            description: "The type of plan this subscription is for",
            example: Examples.Subscription.planType,
        }),
        standing: z.enum(Standing).openapi({
            description: "The standing of this subscription",
            example: Examples.Subscription.standing,
        }),
    }).openapi({
        ref: "Subscription",
        description: "Represents a subscription on Nestri",
        example: Examples.Subscription
    });

    export type Info = z.infer<typeof Info>;

    export const create = fn(
        Info
            .partial({
                teamID: true,
                userID: true,
                id: true,
                standing: true,
                planType: true,
                polarProductID: true,
                polarSubscriptionID: true,
            }),
        (input) =>
            createTransaction(async (tx) => {
                const id = input.id ?? createID("subscription");

                await tx.insert(subscriptionTable).values({
                    id,
                    tokens: input.tokens,
                    polarProductID: input.polarProductID ?? null,
                    polarSubscriptionID: input.polarSubscriptionID ?? null,
                    standing: input.standing ?? "new",
                    planType: input.planType ?? "free",
                    userID: input.userID ?? useUserID(),
                    teamID: input.teamID ?? useTeam(),
                });

                return id;
            })
    )

    export const setPolarProductID = fn(
        Info.pick({
            id: true,
            polarProductID: true,
        }),
        (input) =>
            useTransaction(async (tx) =>
                tx.update(subscriptionTable)
                    .set({
                        polarProductID: input.polarProductID,
                    })
                    .where(eq(subscriptionTable.id, input.id))
            )
    )

    export const setPolarSubscriptionID = fn(
        Info.pick({
            id: true,
            polarSubscriptionID: true,
        }),
        (input) =>
            useTransaction(async (tx) =>
                tx.update(subscriptionTable)
                    .set({
                        polarSubscriptionID: input.polarSubscriptionID,
                    })
                    .where(eq(subscriptionTable.id, input.id))
            )
    )

    export const fromID = fn(z.string(), async (id) =>
        useTransaction(async (tx) =>
            tx
                .select()
                .from(subscriptionTable)
                .where(
                    eq(subscriptionTable.id, id)
                )
                .orderBy(subscriptionTable.timeCreated)
                .then((rows) => rows.map(serialize).at(0))
        )
    )
    export const fromTeamID = fn(z.string(), async (teamID) =>
        useTransaction(async (tx) =>
            tx
                .select()
                .from(subscriptionTable)
                .where(
                    eq(subscriptionTable.teamID, teamID)
                )
                .orderBy(subscriptionTable.timeCreated)
                .then((rows) => rows.map(serialize).at(0))
        )
    )

    export const fromUserID = fn(z.string(), async (userID) =>
        useTransaction(async (tx) =>
            tx
                .select()
                .from(subscriptionTable)
                .where(
                    eq(subscriptionTable.userID, userID)
                )
                .orderBy(subscriptionTable.timeCreated)
                .then((rows) => rows.map(serialize).at(0))
        )
    )
    export const remove = fn(Info.shape.id, (id) =>
        useTransaction(async (tx) =>
            tx
                .update(subscriptionTable)
                .set({
                    timeDeleted: Common.now(),
                })
                .where(eq(subscriptionTable.id, id))
                .execute()
        )
    )

    export function serialize(
        input: typeof subscriptionTable.$inferSelect
    ): z.infer<typeof Info> {
        return {
            id: input.id,
            userID: input.userID,
            teamID: input.teamID,
            standing: input.standing,
            planType: input.planType,
            tokens: input.tokens,
            polarProductID: input.polarProductID,
            polarSubscriptionID: input.polarSubscriptionID,
        };
    }


}