import { z } from "zod";
import { Hono } from "hono";
import { notPublic } from "./auth";
import { describeRoute } from "hono-openapi";
import { Examples } from "@nestri/core/examples";
import { ErrorResponses, Result } from "./common";
import { Friend } from "@nestri/core/friend/index";

export namespace FriendApi {
    export const route = new Hono()
        .use(notPublic)
        .get("/",
            describeRoute({
                tags: ["Friend"],
                summary: "Gets all the user's friend",
                description: "Retrieves all friends associated with the authenticated user",
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(
                                    Friend.Info.array().openapi({
                                        description: "All friends associated with the authenticated user",
                                        example: [{ ...Examples.SteamAccount, user: Examples.User }]
                                    })
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
            async (c) =>
                c.json({
                    data: await Friend.list()
                })
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