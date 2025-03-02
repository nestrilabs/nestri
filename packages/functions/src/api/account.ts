import { z } from "zod";
import { Hono } from "hono";
import { notPublic } from "./auth";
import { Result } from "../common";
import { resolver } from "hono-openapi/zod";
import { describeRoute } from "hono-openapi";
import { User } from "@nestri/core/user/index";
import { Team } from "@nestri/core/team/index";
import { assertActor } from "@nestri/core/actor";

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
                                        ...User.Info.shape,
                                        teams: Team.Info.array(),
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
                const currentUser = await User.fromID(actor.properties.userID)
                if (!currentUser) return c.json({ error: "This account does not exist, it may have been deleted" }, 404)
                const { id, email, name, polarCustomerID, avatarUrl, discriminator } = currentUser

                return c.json({
                    data: {
                        id,
                        email,
                        name,
                        avatarUrl,
                        discriminator,
                        polarCustomerID,
                        teams: await User.teams(),
                    }
                }, 200);
            },
        )
}