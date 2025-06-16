import { Hono } from "hono";
import { notPublic } from "./utils";
import { describeRoute } from "hono-openapi";
import { Examples } from "@nestri/core/examples";
import { ErrorResponses, Result } from "./utils";
import { Account } from "@nestri/core/account/index";

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
                                    Account.Info.openapi({
                                        description: "User account information",
                                        example: { ...Examples.User, profiles: [Examples.SteamAccount] }
                                    })
                                ),
                            },
                        },
                        description: "User account details"
                    },
                    400: ErrorResponses[400],
                    404: ErrorResponses[404],
                    429: ErrorResponses[429],
                }
            }),
            async (c) =>
                c.json({
                    data: await Account.list()
                }, 200)
        )
}