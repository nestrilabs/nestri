import { z } from "zod";
import { Hono } from "hono";
import { Resource } from "sst";
import { notPublic } from "./auth";
import { describeRoute } from "hono-openapi";
import { User } from "@nestri/core/user/index";
import { assertActor } from "@nestri/core/actor";
import { Polar } from "@nestri/core/polar/index";
import { Examples } from "@nestri/core/examples";
import { ErrorResponses, Result, validator } from "./common";
import { ErrorCodes, VisibleError } from "@nestri/core/error";
import { PlanType } from "@nestri/core/subscription/subscription.sql";
import { WebhookVerificationError, validateEvent } from "@polar-sh/sdk/webhooks";

export namespace PolarApi {
    export const route = new Hono()
        .use(notPublic)
        .get("/",
            describeRoute({
                tags: ["Polar"],
                summary: "Create a Polar.sh customer portal",
                description: "Creates Polar.sh's customer portal url where the user can manage their payments",
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(
                                    z.object({
                                        portalUrl: z.string()
                                    }).openapi({
                                        description: "The customer portal url",
                                        example: { portalUrl: "https://polar.sh/portal/39393jdie09292" }
                                    })
                                ),
                            },
                        },
                        description: "customer portal url"
                    },
                    400: ErrorResponses[400],
                    404: ErrorResponses[404],
                    429: ErrorResponses[429],
                }
            }),
            async (c) => {
                const actor = assertActor("user");

                const user = await User.fromID(actor.properties.userID);

                if (!user)
                    throw new VisibleError(
                        "not_found",
                        ErrorCodes.NotFound.RESOURCE_NOT_FOUND,
                        "User not found",
                    );

                if (!user.polarCustomerID)
                    throw new VisibleError(
                        "not_found",
                        ErrorCodes.NotFound.RESOURCE_NOT_FOUND,
                        "User does not contain Polar customer ID"
                    )

                const portalUrl = await Polar.createPortal(user.polarCustomerID)

                return c.json({
                    data: {
                        portalUrl
                    }
                })
            }
        )
        .post("/checkout",
            describeRoute({
                tags: ["Polar"],
                summary: "Create a checkout url",
                description: "Creates a Polar.sh's checkout url for the user to pay a subscription for this team",
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(
                                    z.object({
                                        checkoutUrl: z.string()
                                    }).openapi({
                                        description: "The checkout url",
                                        example: { checkoutUrl: "https://polar.sh/portal/39393jdie09292" }
                                    })
                                ),
                            },
                        },
                        description: "checkout url"
                    },
                    400: ErrorResponses[400],
                    404: ErrorResponses[404],
                    429: ErrorResponses[429],
                }
            }),
            validator(
                "json",
                z
                    .object({
                        planType: z.enum(PlanType),
                        successUrl: z.string().url("Success url must be a valid url")
                    })
                    .openapi({
                        description: "Details of the team to create",
                        example: {
                            planType: Examples.Subscription.planType,
                            successUrl: "https://your-url.io/thanks"
                        },
                    })
            ),
            async (c) => {
                const body = c.req.valid("json");
                const actor = assertActor("user");

                const user = await User.fromID(actor.properties.userID);

                if (!user)
                    throw new VisibleError(
                        "not_found",
                        ErrorCodes.NotFound.RESOURCE_NOT_FOUND,
                        "User not found",
                    );

                if (!user.polarCustomerID)
                    throw new VisibleError(
                        "not_found",
                        ErrorCodes.NotFound.RESOURCE_NOT_FOUND,
                        "User does not contain Polar customer ID"
                    )

                const checkoutUrl = await Polar.createCheckout({ customerID: user.polarCustomerID, planType: body.planType, successUrl: body.successUrl })

                return c.json({
                    data: {
                        checkoutUrl,
                    }
                })
            }
        )
        .post("/webhook",
            async (c) => {
                const requestBody = await c.req.text();

                const webhookSecret = Resource.PolarWebhookSecret.value

                const webhookHeaders = {
                    "webhook-id": c.req.header("webhook-id") ?? "",
                    "webhook-timestamp": c.req.header("webhook-timestamp") ?? "",
                    "webhook-signature": c.req.header("webhook-signature") ?? "",
                };

                let webhookPayload: ReturnType<typeof validateEvent>;
                try {
                    webhookPayload = validateEvent(
                        requestBody,
                        webhookHeaders,
                        webhookSecret,
                    );
                } catch (error) {
                    if (error instanceof WebhookVerificationError) {
                        return c.json({ received: false }, { status: 403 });
                    }

                    throw error;
                }

                await Polar.handleWebhook(webhookPayload)

                return c.json({ received: true });
            }
        )
}