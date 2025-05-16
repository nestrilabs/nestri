import { z } from "zod"
import { Hono } from "hono";
import { validator } from "hono-openapi/zod";
import { describeRoute } from "hono-openapi";
import { Examples } from "@nestri/core/examples";
import { Friend } from "@nestri/core/friend/index";
import { ErrorResponses, notPublic, Result } from "./utils";
import { ErrorCodes, VisibleError } from "@nestri/core/error";

export namespace FriendApi {
    export const route = new Hono()
        .use(notPublic)
        .get("/",
            describeRoute({
                tags: ["Friend"],
                summary: "List friends accounts",
                description: "List all this user's friends accounts",
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(
                                    Friend.Info.array().openapi({
                                        description: "All friends accounts",
                                        example: [Examples.Friend]
                                    })
                                ),
                            },
                        },
                        description: "Friends accounts details"
                    },
                    400: ErrorResponses[400],
                    404: ErrorResponses[404],
                    429: ErrorResponses[429],
                }
            }),
            async (c) =>
                c.json({
                    data: await Friend.list()
                })
        )
        .get("/:id",
            describeRoute({
                tags: ["Friend"],
                summary: "Get a friend",
                description: "Get a friend's details by their SteamID",
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(
                                    Friend.Info.openapi({
                                        description: "Friend's accounts",
                                        example: Examples.Friend
                                    })
                                ),
                            },
                        },
                        description: "Friends accounts details"
                    },
                    400: ErrorResponses[400],
                    404: ErrorResponses[404],
                    429: ErrorResponses[429],
                }
            }),
            validator(
                "param",
                z.object({
                    id: z.string().openapi({
                        description: "ID of the friend to get",
                        example: Examples.Friend.id,
                    }),
                }),
            ),
            async (c) => {
                const friendSteamID = c.req.valid("param").id

                const friend = await Friend.fromFriendID(friendSteamID)

                if (!friend) {
                    throw new VisibleError(
                        "not_found",
                        ErrorCodes.NotFound.RESOURCE_NOT_FOUND,
                        `Friend ${friendSteamID} not found`
                    )
                }

                return c.json({
                    data: friend
                })
            }
        )
}