import { Hono } from "hono";
import { notPublic } from "./auth";
import { describeRoute } from "hono-openapi";
import { Examples } from "@nestri/core/examples";
import { assertActor } from "@nestri/core/actor";
import { ErrorResponses, Result } from "./common";
import { Subscription } from "@nestri/core/subscription/index";

export namespace SubscriptionApi {
    export const route = new Hono()
        .use(notPublic)
        .get("/",
            describeRoute({
                tags: ["Subscription"],
                summary: "Get user subscriptions",
                description: "Get all user subscriptions",
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(
                                    Subscription.BasicInfo.array().openapi({
                                        description: "All the subscriptions this user has",
                                        example: [Examples.Subscription]
                                    })
                                ),
                            },
                        },
                        description: "All user subscriptions"
                    },
                    400: ErrorResponses[400],
                    404: ErrorResponses[404],
                    429: ErrorResponses[429],
                }
            }),
            async (c) => {
                const actor = assertActor("user")

                const subscriptions = await Subscription.fromUserID(actor.properties.userID)

                return c.json({
                    data: subscriptions
                })
            }
        )
}