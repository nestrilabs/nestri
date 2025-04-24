import { z } from "zod";
import { Hono } from "hono";
import { notPublic } from "./auth";
import { describeRoute } from "hono-openapi";
import { Examples } from "@nestri/core/examples";
import { assertActor } from "@nestri/core/actor";
import { Steam } from "@nestri/core/steam/index";
import { ErrorResponses, Result } from "./common";
import { Friend } from "@nestri/core/friend/index";

export namespace FriendApi {
    export const route = new Hono()
        .use(notPublic)
        .get("/",
            describeRoute({
                tags: ["Friend"],
                summary: "Get all the user's friend",
                description: "Retrieves all friends associated with the authenticated user",
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(
                                    Steam.FullInfo.array().openapi({
                                        description: "All friends associated with the authenticated user",
                                        example: [{ ...Examples.Steam, user: Examples.User }]
                                    })
                                ),
                            },
                        },
                        description: "Steam accounts of this user"
                    },
                    400: ErrorResponses[400],
                    404: ErrorResponses[404],
                }
            }),
            async (c) => {
                assertActor("user")

                const friends = await Friend.list()

                return c.json({
                    data: friends
                })
            }
        )
        .get("/sync",
            describeRoute({
                tags: ["Friend"],
                summary: "Sync the user's friend",
                description: "Syncs all the user's friends from Steam",
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(
                                    z.literal("ok")
                                ),
                            },
                        },
                        description: "Steam accounts of this user"
                    },
                    400: ErrorResponses[400],
                    404: ErrorResponses[404],
                    429: ErrorResponses[429],
                }
            }),
            async (c) => {
                //TODO: Please add the sync functionality here
            }
        )
}