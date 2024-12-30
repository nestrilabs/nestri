import { z } from "zod";
import { Hono } from "hono";
import { Result } from "./common";
import { validator } from "hono-openapi/zod";
import { describeRoute } from "hono-openapi";
import { Examples } from "@nestri/core/examples"
import { Subscription } from "@nestri/core/subscription/index";

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
                                    Subscription.Info.array().openapi({
                                        description: "List of subscriptions.",
                                        example: [Examples.Subscription],
                                    }),
                                ),
                            },
                        },
                        description: "List of subscriptions.",
                    },
                },
            }),
            async (c) => {
                const data = await Subscription.list();
                return c.json(
                    {
                        data,
                    },
                    200,
                );
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
                },
            }),
            validator(
                "json",
                Subscription.Info.omit({ id: true }).openapi({
                    description: "Subscription information.",
                    //@ts-expect-error
                    example: { ...Examples.Subscription, id: undefined, next: undefined },
                }),
            ),
            async (c) => {
                const body = c.req.valid("json");
                await Subscription.create(body);
                return c.json({ data: "ok" as const }, 200);
            },
        )
}