import { z } from "zod";
import { Hono } from "hono";
import { Result } from "../common";
import { describeRoute } from "hono-openapi";
import { Examples } from "@nestri/core/examples";
import { validator, resolver } from "hono-openapi/zod";
import { Subscriptions } from "@nestri/core/subscription/index";
import { Email } from "@nestri/core/email/index";

export module SubscriptionApi {
    export const route = new Hono()
        .get(
            "/",
            describeRoute({
                tags: ["Subscription"],
                summary: "List subscriptions",
                description: "List the subscriptions associated with the current user.",
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(
                                    Subscriptions.Info.array().openapi({
                                        description: "List of subscriptions.",
                                        example: [Examples.Subscription],
                                    }),
                                ),
                            },
                        },
                        description: "List of subscriptions.",
                    },
                    404: {
                        content: {
                            "application/json": {
                                schema: resolver(z.object({ error: z.string() })),
                            },
                        },
                        description: "No subscriptions found for this user",
                    },
                },
            }),
            async (c) => {
                const data = await Subscriptions.list(undefined);
                if (!data) return c.json({ error: "No subscriptions found for this user" }, 404);
                return c.json({ data }, 200);
            },
        )
        .post(
            "/",
            describeRoute({
                tags: ["Subscription"],
                summary: "Subscribe",
                description: "Create a subscription for the current user.",
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(z.literal("ok")),
                            },
                        },
                        description: "Subscription was created successfully.",
                    },
                    400: {
                        content: {
                            "application/json": {
                                schema: resolver(z.object({ error: z.string() })),
                            },
                        },
                        description: "Subscription already exists.",
                    },
                },
            }),
            validator(
                "json",
                z.object({
                    checkoutID: Subscriptions.Info.shape.id.openapi({
                        description: "The checkout id information.",
                        example: Examples.Subscription.id,
                    })
                }),
            ),
            async (c) => {
                const body = c.req.valid("json");
                const data = await Subscriptions.fromCheckoutID(body.checkoutID)
                if (data) return c.json({ error: "Subscription already exists" })
                await Subscriptions.create(body);
                return c.json({ data: "ok" as const }, 200);
            },
        )
        .delete(
            "/:id",
            describeRoute({
                tags: ["Subscription"],
                summary: "Cancel",
                description: "Cancel a subscription for the current user.",
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(z.literal("ok")),
                            },
                        },
                        description: "Subscription was cancelled successfully.",
                    },
                    404: {
                        content: {
                            "application/json": {
                                schema: resolver(z.object({ error: z.string() })),
                            },
                        },
                        description: "Subscription not found.",
                    },
                },
            }),
            validator(
                "param",
                z.object({
                    id: Subscriptions.Info.shape.id.openapi({
                        description: "ID of the subscription to cancel.",
                        example: Examples.Subscription.id,
                    }),
                }),
            ),
            async (c) => {
                const param = c.req.valid("param");
                const subscription = await Subscriptions.fromID(param.id);
                if (!subscription) return c.json({ error: "Subscription not found" }, 404);
                await Subscriptions.remove(param.id);
                return c.json({ data: "ok" as const }, 200);
            },
        );
}