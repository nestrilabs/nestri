import { z } from "zod";
import databaseClient from "../database"
import { fn } from "../utils";
import { groupBy, map, pipe, values } from "remeda"
import { Common } from "../common";
import { Examples } from "../examples";
import { useCurrentUser } from "../actor";
import { id as createID } from "@instantdb/admin";
import { Email } from "../email";
import { Profiles } from "../profile";

export const SubscriptionFrequency = z.enum([
    "fixed",
    "daily",
    "weekly",
    "monthly",
    "yearly",
]);

export type SubscriptionFrequency = z.infer<typeof SubscriptionFrequency>;

export namespace Subscriptions {
    export const Info = z
        .object({
            id: z.string().openapi({
                description: Common.IdDescription,
                example: Examples.Subscription.id,
            }),
            checkoutID: z.string().openapi({
                description: "The polar.sh checkout id",
                example: Examples.Subscription.checkoutID,
            }),
            // productID: z.string().openapi({
            //     description: "ID of the product being subscribed to.",
            //     example: Examples.Subscription.productID,
            // }),
            // quantity: z.number().int().openapi({
            //     description: "Quantity of the subscription.",
            //     example: Examples.Subscription.quantity,
            // }),
            // frequency: SubscriptionFrequency.openapi({
            //     description: "Frequency of the subscription.",
            //     example: Examples.Subscription.frequency,
            // }),
            // next: z.string().or(z.number()).openapi({
            //     description: "Next billing date for the subscription.",
            //     example: Examples.Subscription.next,
            // }),
            canceledAt: z.string().or(z.number()).optional().openapi({
                description: "Cancelled date for the subscription.",
                example: Examples.Subscription.canceledAt,
            }),
        })
        .openapi({
            ref: "Subscription",
            description: "Subscription to a Nestri product.",
            example: Examples.Subscription,
        });

    export type Info = z.infer<typeof Info>;

    export const list = fn(z.string().optional(), async (userID) => {
        const db = databaseClient()
        const user = userID ? userID : useCurrentUser().id

        const query = {
            subscriptions: {
                $: {
                    where: {
                        owner: user,
                        canceledAt: { $isNull: true }
                    }
                },
            }
        }

        const res = await db.query(query)

        const response = res.subscriptions
        if (!response || response.length === 0) {
            return null
        }

        const result = pipe(
            response,
            groupBy(x => x.id),
            values(),
            map((group): Info => ({
                id: group[0].id,
                // next: group[0].next,
                // frequency: group[0].frequency as any,
                // quantity: group[0].quantity,
                // productID: group[0].productID,
                checkoutID: group[0].checkoutID,
            }))
        )

        return result
    })

    export const create = fn(Info.omit({ id: true, canceledAt: true }), async (input) => {
        // const id = createID()
        const id = createID()
        const db = databaseClient()
        const user = useCurrentUser()

        //Use the polar.sh ID
        await db.transact(db.tx.subscriptions[id]!.update({
            // next: input.next,
            // frequency: input.frequency,
            // quantity: input.quantity,
            checkoutID: input.checkoutID,
        }).link({ owner: user.id }))
        const res = await db.auth.getUser({ id: user.id })
        const profile = await Profiles.getProfile(user.id)
        if (profile) {
            await Email.sendWelcome(res.email, profile.username)
        }

    })

    export const remove = fn(z.string(), async (id) => {
        const db = databaseClient()

        await db.transact(db.tx.subscriptions[id]!.update({
            canceledAt: new Date().toISOString()
        }))
    })

    export const fromID = fn(z.string(), async (id) => {
        const db = databaseClient()
        const user = useCurrentUser()
        const query = {
            subscriptions: {
                $: {
                    where: {
                        id,
                        //Make sure they can only get subscriptions they own
                        owner: user.id,
                        canceledAt: { $isNull: true }
                    }
                },
            }
        }

        const res = await db.query(query)

        const response = res.subscriptions
        if (!response || response.length === 0) {
            return null
        }

        const result = pipe(
            response,
            groupBy(x => x.id),
            values(),
            map((group): Info => ({
                id: group[0].id,
                checkoutID: group[0].checkoutID,
                // next: group[0].next,
                // frequency: group[0].frequency as any,
                // quantity: group[0].quantity,
                // productID: group[0].productID,
            }))
        )

        return result[0]
    })

    export const fromCheckoutID = fn(z.string(), async (id) => {
        const db = databaseClient()
        const user = useCurrentUser()
        const query = {
            subscriptions: {
                $: {
                    where: {
                        id,
                        //Make sure they can only get subscriptions they own
                        checkoutID: id,
                        canceledAt: { $isNull: true }
                    }
                },
            }
        }

        const res = await db.query(query)

        const response = res.subscriptions
        if (!response || response.length === 0) {
            return null
        }

        const result = pipe(
            response,
            groupBy(x => x.id),
            values(),
            map((group): Info => ({
                id: group[0].id,
                checkoutID: group[0].checkoutID,
            }))
        )

        return result[0]
    })
}