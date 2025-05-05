import { z } from "zod";
import { Common } from "../common";
import { Examples } from "../examples";
import { createID, fn } from "../utils";
import { eq, and, isNull } from "../drizzle";
import { useTeam, useUserID } from "../actor";
import { createTransaction, useTransaction } from "../drizzle/transaction";
import { PlanType, Standing, subscriptionTable } from "./subscription.sql";

export namespace Subscription {
    export const BasicInfo = z.object({
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
            example: Examples.Subscription.ownerID,
        }),
        // productVariantID: z.string().openapi({
        //     description: "The unique id of the product this subscription is for",
        //     example: Examples.Subscription.polarProductID,
        // }),
        tokens: z.number().openapi({
            description: "The number of tokens this subscription has left",
            example: Examples.Subscription.tokens,
        }),
        planType: z.enum(PlanType).openapi({
            description: "The type of plan this subscription is for",
            example: Examples.Subscription.planType,
        }),
        status: z.enum(Standing).openapi({
            description: "The standing of this subscription",
            example: Examples.Subscription.standing,
        }),
    }).openapi({
        ref: "Subscription",
        description: "Represents a subscription on Nestri",
        example: Examples.Subscription
    });

    export type BasicInfo = z.infer<typeof BasicInfo>;

    export const create = fn(
        BasicInfo
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
        BasicInfo.pick({
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
        BasicInfo.pick({
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

    export const fromID = fn(BasicInfo.shape.id.min(1), async (id) =>
        useTransaction(async (tx) =>
            tx
                .select()
                .from(subscriptionTable)
                .where(
                    and(
                        eq(subscriptionTable.id, id),
                        isNull(subscriptionTable.timeDeleted)
                    )
                )
                .orderBy(subscriptionTable.timeCreated)
                .then((rows) => rows.map(serializeBasic))
        )
    )
    export const fromTeamID = fn(BasicInfo.shape.teamID.min(1), async (teamID) =>
        useTransaction(async (tx) =>
            tx
                .select()
                .from(subscriptionTable)
                .where(
                    and(
                        eq(subscriptionTable.teamID, teamID),
                        isNull(subscriptionTable.timeDeleted)
                    )
                )
                .orderBy(subscriptionTable.timeCreated)
                .then((rows) => rows.map(serializeBasic))
        )
    )

    export const fromUserID = fn(BasicInfo.shape.userID.min(1), async (userID) =>
        useTransaction(async (tx) =>
            tx
                .select()
                .from(subscriptionTable)
                .where(
                    and(
                        eq(subscriptionTable.userID, userID),
                        isNull(subscriptionTable.timeDeleted)
                    )
                )
                .orderBy(subscriptionTable.timeCreated)
                .then((rows) => rows.map(serializeBasic))
        )
    )

    export const remove = fn(BasicInfo.shape.id.min(1), (id) =>
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

    /**
     * Converts a raw subscription database record into a structured {@link BasicInfo} object.
     *
     * @param input - The subscription record retrieved from the database.
     * @returns The subscription data formatted according to the {@link BasicInfo} schema.
     */
    export function serializeBasic(
        input: typeof subscriptionTable.$inferSelect
    ): z.infer<typeof BasicInfo> {
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