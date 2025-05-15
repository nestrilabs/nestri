import { z } from "zod"
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { Game } from "@nestri/core/game/index";
import { Examples } from "@nestri/core/examples";
import { Library } from "@nestri/core/library/index";
import { ErrorCodes, VisibleError } from "@nestri/core/error";
import { ErrorResponses, notPublic, Result, validator } from "./utils";

export namespace GameApi {
    export const route = new Hono()
        .use(notPublic)
        .get("/",
            describeRoute({
                tags: ["Game"],
                summary: "List games",
                description: "List all the games on this user's library",
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(
                                    Game.Info.array().openapi({
                                        description: "All games in the library",
                                        example: [Examples.Game]
                                    })
                                ),
                            },
                        },
                        description: "All games in the library"
                    },
                    400: ErrorResponses[400],
                    404: ErrorResponses[404],
                    429: ErrorResponses[429],
                }
            }),
            async (c) =>
                c.json({
                    data: await Library.list()
                })
        )
        .get("/:id",
            describeRoute({
                tags: ["Game"],
                summary: "Get game",
                description: "Get a game by its id, it does not have to be in user's library",
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(
                                    Game.Info.openapi({
                                        description: "Game details",
                                        example: Examples.Game
                                    })
                                ),
                            },
                        },
                        description: "Game details"
                    },
                    400: ErrorResponses[400],
                    429: ErrorResponses[429],
                }
            }),
            validator(
                "param",
                z.object({
                    id: z.string().openapi({
                        description: "ID of the game to get",
                        example: Examples.Game.id,
                    }),
                }),
            ),
            async (c) => {
                const gameID = c.req.valid("param").id

                const game = await Game.fromID(gameID)

                if (!game) {
                    throw new VisibleError(
                        "not_found",
                        ErrorCodes.NotFound.RESOURCE_NOT_FOUND,
                        `Game ${gameID} does not exist`
                    )
                }

                return c.json({
                    data: game
                })
            }
        )
}