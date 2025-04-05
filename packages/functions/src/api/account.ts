import { z } from "zod";
import { Hono } from "hono";
import { notPublic } from "./auth";
import { describeRoute } from "hono-openapi";
import { User } from "@nestri/core/user/index";
import { Team } from "@nestri/core/team/index";
import { assertActor } from "@nestri/core/actor";
import { Examples } from "@nestri/core/examples";
import { ErrorResponses, Result } from "./common";
import { ErrorCodes, VisibleError } from "@nestri/core/error";

export namespace AccountApi {
    export const route = new Hono()
        .use(notPublic)
        .get("/",
            describeRoute({
                tags: ["Account"],
                summary: "Get user account",
                description: "Get the current user's account details",
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(
                                    z.object({
                                        ...User.Info.shape,
                                        teams: Team.Info.array(),
                                    }).openapi({
                                        description: "User account information",
                                        example: { ...Examples.User, teams: [Examples.Team] }
                                    })
                                ),
                            },
                        },
                        description: "User account details"
                    },
                    404: ErrorResponses[404]
                }
            }),
            async (c) => {
                const actor = assertActor("user");
                const [currentUser, teams] = await Promise.all([User.fromID(actor.properties.userID), User.teams()])

                if (!currentUser)
                    throw new VisibleError(
                        "not_found",
                        ErrorCodes.NotFound.RESOURCE_NOT_FOUND,
                        "User not found",
                    );

                const { id, email, name, polarCustomerID, avatarUrl, discriminator } = currentUser

                return c.json({
                    data: {
                        id,
                        name,
                        email,
                        teams,
                        avatarUrl,
                        discriminator,
                        polarCustomerID,
                    }
                }, 200);
            },
        )
}