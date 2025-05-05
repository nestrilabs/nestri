import { z } from "zod";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { Game } from "@nestri/core/game/index";
import { ErrorResponses, Result } from "./common";
import { Examples } from "@nestri/core/examples";
import { assertActor } from "@nestri/core/actor";
import { notPublic } from "./auth";

export namespace GameApi {
    export const route = new Hono()
        .use(notPublic)
        .get("/",
            describeRoute({
                tags: ["Steam"],
                summary: "Get the user's games",
                description: "Gets the games this user owns on Steam",
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(
                                    Game.FullInfo.array().openapi({
                                        description: "All the games this user owns",
                                        example: [Examples.Game]
                                    })
                                ),
                            },
                        },
                        description: "Games owned by the user"
                    },
                    400: ErrorResponses[400],
                    404: ErrorResponses[404],
                    429: ErrorResponses[429],
                }
            }),
            async (c) => {
                assertActor("user")
                const games = await Game.list()
                return c.json({ data: games })
            }
        )
        .get("/sync",
            describeRoute({
                tags: ["Steam"],
                summary: "Syncs a user's game library",
                description: "Syncs a user's game library with Steam",
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(
                                    z.literal("ok")
                                ),
                            },
                        },
                        description: "Games owned by the user"
                    },
                    400: ErrorResponses[400],
                    404: ErrorResponses[404],
                    429: ErrorResponses[429],
                }
            }),
            async (c) => {
                //TODO: Implement this
            }
        )
}