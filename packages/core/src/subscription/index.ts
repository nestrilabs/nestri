import { z } from "zod";
import { Common } from "../common";
import { Examples } from "../examples";
import databaseClient from "../database"
import { useCurrentUser } from "../actor";
import { createID, fn } from "../utils";
import { Product } from "../product";
import { User } from "../user";

export const SubscriptionFrequency = z.enum([
    "monthly",
    "yearly",
]);

export module Subscription {
    export const Info = z
        .object({
            id: z.string().openapi({
                description: Common.IdDescription,
                example: Examples.Subscription.id,
            }),
            productVariant: Product.Variant.openapi({
                description: "ID of the product variant being subscribed to.",
                example: Examples.ProductVariant,
            }),
            quantity: z.number().int().openapi({
                description: "Quantity of the subscription.",
                example: Examples.Subscription.quantity,
            }),
            frequency: SubscriptionFrequency.openapi({
                description: "Frequency of the subscription.",
                example: Examples.Subscription.frequency,
            }),
            polarOrderID: z.string().openapi({
                description: "Order Id to identify this subscription on Polar.sh",
                example: Examples.Subscription.frequency,
            }),
            next: z.number().optional().openapi({
                description: "Next billing date for the subscription.",
                example: Examples.Subscription.next,
            }),
            owner: User.Info.openapi({
                description: "The user who has this subscription",
                example: Examples.User
            })
        })
        .openapi({
            ref: "Subscription",
            description: "Subscription to a Nestri product.",
            example: Examples.Subscription,
        });

    export const list = async () => {
        const user = useCurrentUser();
        const query = {
            "subscriptions": {
                $: {
                    where: {
                        owner: user.id,
                    },
                },
            },
        };

        const db = databaseClient().asUser({ token: user.token });

        const res = await db.query(query)

        return res.subscriptions
    }

    export const create = fn(Info.omit({ id: true, owner: true, productVariant: true }), async (input) => {
        const user = useCurrentUser();

        const id = createID("subscription");
        // const db = databaseClient().asUser({ token: user.token });

        // db.transact(db.tx.subscriptions[id]!.update({
        //     polarOrderID: input.polarOrderID,
        //     frequency: input.frequency,
        //     next: input.next,
        //     quantity: input.quantity
        // }).link({ owner: user.id, productVariant: input.productVariantID }))

        return id
    })

}