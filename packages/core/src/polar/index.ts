import { z } from "zod";
import { fn } from "../utils";
import { Resource } from "sst";
import { eq, and } from "../drizzle";
import { useTeam } from "../actor";
import { createEvent } from "../event";
import { polarTable, Standing } from "./polar.sql";
import { Polar as PolarSdk } from "@polar-sh/sdk";
import { useTransaction } from "../drizzle/transaction";

const polar = new PolarSdk({ accessToken: Resource.PolarSecret.value, server: Resource.App.stage !== "production" ? "sandbox" : "production" });

export module Polar {
    export const client = polar;

    export const Info = z.object({
        teamID: z.string(),
        customerID: z.string(),
        subscriptionID: z.string().nullable(),
        subscriptionItemID: z.string().nullable(),
        standing: z.enum(Standing),
    });

    export type Info = z.infer<typeof Info>;

    export const Checkout = z.object({
        annual: z.boolean().optional(),
        successUrl: z.string(),
        cancelUrl: z.string(),
    });

    export const CheckoutSession = z.object({
        url: z.string().nullable(),
    });

    export const CustomerSubscriptionEventType = [
        "created",
        "updated",
        "deleted",
    ] as const;

    export const Events = {
        CustomerSubscriptionEvent: createEvent(
            "polar.customer-subscription-event",
            z.object({
                type: z.enum(CustomerSubscriptionEventType),
                status: z.string(),
                teamID: z.string().min(1),
                customerID: z.string().min(1),
                subscriptionID: z.string().min(1),
                subscriptionItemID: z.string().min(1),
            }),
        ),
    };

    export function get() {
        return useTransaction(async (tx) =>
            tx
                .select()
                .from(polarTable)
                .where(eq(polarTable.teamID, useTeam()))
                .execute()
                .then((rows) => rows.map(serialize).at(0)),
        );
    }

    export const fromUserEmail = fn(z.string().min(1), async (email) => {
        try {
            const customers = await client.customers.list({ email })

            if (customers.result.items.length === 0) {
                return await client.customers.create({ email })
            } else {
                return customers.result.items[0]
            }

        } catch (err) {
            //FIXME: This is the issue [Polar.sh/#5147](https://github.com/polarsource/polar/issues/5147)
            // console.log("error", err)
            return undefined
        }
    })

    export const setCustomerID = fn(Info.shape.customerID, async (customerID) =>
        useTransaction(async (tx) =>
            tx
                .insert(polarTable)
                .values({
                    teamID: useTeam(),
                    customerID,
                    standing: "new",
                })
                .execute(),
        ),
    );

    export const setSubscription = fn(
        Info.pick({
            subscriptionID: true,
            subscriptionItemID: true,
        }),
        (input) =>
            useTransaction(async (tx) =>
                tx
                    .update(polarTable)
                    .set({
                        subscriptionID: input.subscriptionID,
                        subscriptionItemID: input.subscriptionItemID,
                    })
                    .where(eq(polarTable.teamID, useTeam()))
                    .returning()
                    .execute()
                    .then((rows) => rows.map(serialize).at(0)),
            ),
    );

    export const removeSubscription = fn(
        z.string().min(1),
        (stripeSubscriptionID) =>
            useTransaction((tx) =>
                tx
                    .update(polarTable)
                    .set({
                        subscriptionItemID: null,
                        subscriptionID: null,
                    })
                    .where(and(eq(polarTable.subscriptionID, stripeSubscriptionID)))
                    .execute(),
            ),
    );

    export const setStanding = fn(
        Info.pick({
            subscriptionID: true,
            standing: true,
        }),
        (input) =>
            useTransaction((tx) =>
                tx
                    .update(polarTable)
                    .set({ standing: input.standing })
                    .where(and(eq(polarTable.subscriptionID, input.subscriptionID!)))
                    .execute(),
            ),
    );

    export const fromCustomerID = fn(Info.shape.customerID, (customerID) =>
        useTransaction((tx) =>
            tx
                .select()
                .from(polarTable)
                .where(and(eq(polarTable.customerID, customerID)))
                .execute()
                .then((rows) => rows.map(serialize).at(0)),
        ),
    );

    function serialize(
        input: typeof polarTable.$inferSelect,
    ): z.infer<typeof Info> {
        return {
            teamID: input.teamID,
            customerID: input.customerID,
            subscriptionID: input.subscriptionID,
            subscriptionItemID: input.subscriptionItemID,
            standing: input.standing,
        };
    }
}