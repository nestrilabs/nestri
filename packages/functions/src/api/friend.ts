import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { ErrorResponses, Result } from "./utils";
import { Examples } from "@nestri/core/examples";
import { Friend } from "@nestri/core/friend/index";

export namespace FriendApi {
    export const route = new Hono()
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
                                        example: [{ ...Examples.SteamAccount, user: Examples.User }]
                                    })
                                ),
                            },
                        },
                        description: "Friends accounts details"
                    },
                    400: ErrorResponses[400],
                    429: ErrorResponses[429],
                }
            }),
            async (c) =>
                c.json({
                    data: await Friend.list()
                })
        )
}