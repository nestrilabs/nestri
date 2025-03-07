import { z } from "zod";
import { Hono } from "hono";
import { notPublic } from "./auth";
import { Result } from "../common";
import { resolver } from "hono-openapi/zod";
import { describeRoute } from "hono-openapi";
import { User } from "@nestri/core/user/index";
import { Team } from "@nestri/core/team/index";
import { assertActor } from "@nestri/core/actor";
import { Examples } from "@nestri/core/examples";

export module AccountApi {
    export const route = new Hono()
        .use(notPublic)
        .get("/",
            describeRoute({
                tags: ["Account"],
                summary: "Retrieve the current user's details",
                description: "Returns the user's account details, plus the teams they have joined",
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(
                                    z.object({
                                        id: z.string(),
                                        email: z.string(),
                                        teams: Team.Info.array(),
                                    }).openapi({
                                        example: { ...Examples.User, teams: [Examples.Team] },
                                        description: "The user information associated with this account"
                                    })
                                ),
                            },
                        },
                        description: "Successfully retrieved account details"
                    },
                    404: {
                        content: {
                            "application/json": {
                                schema: resolver(z.object({ error: z.string() })),
                            },
                        },
                        description: "This account does not exist",
                    },
                }
            }),
            async (c) => {
                const actor = assertActor("user");
                // const [currentUser, teams] = await Promise.all([User.fromID(actor.properties.userID), User.teams()])

                // if (!currentUser) return c.json({ error: "This account does not exist; it may have been deleted" }, 404)

                // const { id, email, name, polarCustomerID, avatarUrl, discriminator } = currentUser

                return c.json({
                    data: {
                        id: actor.properties.userID,
                        email: actor.properties.email,
                        teams: await User.teams(),
                        // email,
                        // name,
                        // avatarUrl,
                        // discriminator,
                        // polarCustomerID,
                    }
                }, 200);
            },
        )
}