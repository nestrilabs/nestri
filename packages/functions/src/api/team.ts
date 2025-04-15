import { z } from "zod";
import { Hono } from "hono";
import { notPublic } from "./auth";
import { describeRoute } from "hono-openapi";
import { User } from "@nestri/core/user/index";
import { Team } from "@nestri/core/team/index";
import { Examples } from "@nestri/core/examples";
import { Polar } from "@nestri/core/polar/index";
import { Member } from "@nestri/core/member/index";
import { assertActor, withActor } from "@nestri/core/actor";
import { ErrorResponses, Result, validator } from "./common";
import { Subscription } from "@nestri/core/subscription/index";
import { PlanType } from "@nestri/core/subscription/subscription.sql";

export namespace TeamApi {
    export const route = new Hono()
        .use(notPublic)
        .get("/",
            describeRoute({
                tags: ["Team"],
                summary: "List teams",
                description: "List the teams associated with the current user",
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(
                                    Team.Info.array().openapi({
                                        description: "List of teams",
                                        example: [Examples.Team]
                                    })
                                ),
                            },
                        },
                        description: "List of teams"
                    },
                }
            }),
            async (c) => {
                return c.json({
                    data: await User.teams()
                }, 200);
            },
        )
        .post("/",
            describeRoute({
                tags: ["Team"],
                summary: "Create a team",
                description: "Create a team for the current user",
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(
                                    z.object({
                                        checkoutUrl: z.string().openapi({
                                            description: "The checkout url to confirm subscription for this team",
                                            example: "https://polar.sh/checkout/2903038439320298377"
                                        })
                                    })
                                )
                            }
                        },
                        description: "Team created succesfully"
                    },
                    400: ErrorResponses[400],
                    409: ErrorResponses[409],
                    429: ErrorResponses[429],
                    500: ErrorResponses[500],
                }
            }),
            validator(
                "json",
                Team.create.schema
                    .pick({ slug: true, name: true })
                    .extend({ planType: z.enum(PlanType), successUrl: z.string() })
                    .openapi({
                        description: "Details of the team to create",
                        example: {
                            slug: Examples.Team.slug,
                            name: Examples.Team.name,
                            planType: Examples.Subscription.planType,
                            successUrl: "https://your-url.io/thanks"
                        },
                    })
            ),
            async (c) => {
                const body = c.req.valid("json")
                const actor = assertActor("user");

                const teamID = await Team.create({ name: body.name, slug: body.slug });

                await withActor(
                    {
                        type: "system",
                        properties: {
                            teamID,
                        },
                    },
                    async () => {
                        await Member.create({
                            first: true,
                            email: actor.properties.email,
                        });

                        await Subscription.create({
                            planType: body.planType,
                            userID: actor.properties.userID,
                            // FIXME: Make this make sense
                            tokens: body.planType === "free" ? 100 : body.planType === "pro" ? 1000 : body.planType === "family" ? 10000 : 0,
                        });
                    }
                );

                const checkoutUrl = await Polar.createCheckout({ planType: body.planType, successUrl: body.successUrl, teamID })

                return c.json({
                    data: {
                        checkoutUrl,
                    }
                })
            }
        )
}