import { z } from "zod";
import { Hono } from "hono";
import { Result } from "../common";
import { describeRoute } from "hono-openapi";
import { Games } from "@nestri/core/game/index";
import { Examples } from "@nestri/core/examples";
import { validator, resolver } from "hono-openapi/zod";
import { Sessions } from "@nestri/core/session/index";

export module GameApi {
    export const route = new Hono()
        .get(
            "/",
            //FIXME: Add a way to filter through query params
            describeRoute({
                tags: ["Game"],
                summary: "Retrieve all games",
                description: "Returns a list of all (known) games owned by the authenticated user",
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(
                                    Games.Info.array().openapi({
                                        description: "A list of games owned by the user",
                                        example: [Examples.Game],
                                    }),
                                ),
                            },
                        },
                        description: "Successfully retrieved the user's library of games",
                    },
                    404: {
                        content: {
                            "application/json": {
                                schema: resolver(z.object({ error: z.string() })),
                            },
                        },
                        description: "No games were found in the authenticated user's library",
                    },
                },
            }),
            async (c) => {
                const games = await Games.list();
                if (!games) return c.json({ error: "No games exist in this user's library" }, 404);
                return c.json({ data: games }, 200);
            },
        )
        .get(
            "/:steamID",
            describeRoute({
                tags: ["Game"],
                summary: "Retrieve game by its Steam ID",
                description: "Fetches detailed metadata about a specific game using its Steam ID",
                responses: {
                    404: {
                        content: {
                            "application/json": {
                                schema: resolver(z.object({ error: z.string() })),
                            },
                        },
                        description: "No game found matching the provided Steam ID",
                    },
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(
                                    Games.Info.openapi({
                                        description: "Detailed metadata about the requested game",
                                        example: Examples.Game,
                                    }),
                                ),
                            },
                        },
                        description: "Successfully retrieved game metadata",
                    },
                },
            }),
            validator(
                "param",
                z.object({
                    steamID: Games.Info.shape.steamID.openapi({
                        description: "The unique Steam ID used to identify a game",
                        example: Examples.Game.steamID,
                    }),
                }),
            ),
            async (c) => {
                const params = c.req.valid("param");
                const game = await Games.fromSteamID(params.steamID);
                if (!game) return c.json({ error: "Game not found" }, 404);
                return c.json({ data: game }, 200);
            },
        )
        .post(
            "/:steamID",
            describeRoute({
                tags: ["Game"],
                summary: "Add a game to the user's library using its Steam ID",
                description: "Associates Adds a game to the currently authenticated user's library by linking it with its Steam ID. Once added, the user can play the game and share their progress with others",
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(z.literal("ok"))
                            },
                        },
                        description: "Game successfully added to user's library",
                    },
                    404: {
                        content: {
                            "application/json": {
                                schema: resolver(z.object({ error: z.string() })),
                            },
                        },
                        description: "No game was found matching the provided Steam ID",
                    },
                },
            }),
            validator(
                "param",
                z.object({
                    steamID: Games.Info.shape.steamID.openapi({
                        description: "The unique Steam ID of the game to be link to the current user's library",
                        example: Examples.Game.steamID,
                    }),
                }),
            ),
            async (c) => {
                const params = c.req.valid("param")
                const game = await Games.fromSteamID(params.steamID)
                if (!game) return c.json({ error: "Game not found" }, 404);
                const res = await Games.linkToCurrentUser(game.id)
                return c.json({ data: res }, 200);
            },
        )
        .delete(
            "/:steamID",
            describeRoute({
                tags: ["Game"],
                summary: "Remove game from user's library",
                description: "Removes a game from the authenticated user's library. The game remains in the system but will no longer be accessible to the user",
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(z.literal("ok")),
                            },
                        },
                        description: "Game successfully removed from library",
                    },
                    404: {
                        content: {
                            "application/json": {
                                schema: resolver(z.object({ error: z.string() })),
                            },
                        },
                        description: "The game with the specified Steam ID was not found",
                    },
                }
            }),
            validator(
                "param",
                z.object({
                    steamID: Games.Info.shape.steamID.openapi({
                        description: "The Steam ID of the game to be removed",
                        example: Examples.Game.steamID,
                    }),
                }),
            ),
            async (c) => {
                const params = c.req.valid("param");
                const res = await Games.unLinkFromCurrentUser(params.steamID)
                if (!res) return c.json({ error: "Game not found the library" }, 404);
                return c.json({ data: res }, 200);
            },
        )
        .put(
            "/",
            describeRoute({
                tags: ["Game"],
                summary: "Update game metadata",
                description: "Updates the metadata about a specific game using its Steam ID",
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(z.literal("ok")),
                            },
                        },
                        description: "Game successfully updated",
                    },
                    404: {
                        content: {
                            "application/json": {
                                schema: resolver(z.object({ error: z.string() })),
                            },
                        },
                        description: "The game with the specified Steam ID was not found",
                    },
                }
            }),
            validator(
                "json",
                Games.Info.omit({ id: true }).openapi({
                    description: "Game information",
                    //@ts-expect-error
                    example: { ...Examples.Game, id: undefined }
                })
            ),
            async (c) => {
                const params = c.req.valid("json");
                const res = await Games.create(params)
                if (!res) return c.json({ error: "Something went seriously wrong" }, 404);
                return c.json({ data: res }, 200);
            },
        )
        .get(
            "/:steamID/sessions",
            describeRoute({
                tags: ["Game"],
                summary: "Retrieve game sessions by their Steam ID",
                description: "Fetches active and public game sessions about a specific game using its Steam ID",
                responses: {
                    404: {
                        content: {
                            "application/json": {
                                schema: resolver(z.object({ error: z.string() })),
                            },
                        },
                        description: "No game sessions found matching  for the game with the provided Steam ID",
                    },
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(
                                    Sessions.Info.openapi({
                                        description: "Metadata about the requested game sessions",
                                        example: Examples.Session,
                                    }),
                                ),
                            },
                        },
                        description: "Successfully retrieved game sessions for this game",
                    },
                },
            }),
            validator(
                "param",
                z.object({
                    steamID: Games.Info.shape.steamID.openapi({
                        description: "The unique Steam ID used to identify a game",
                        example: Examples.Game.steamID,
                    }),
                }),
            ),
            async (c) => {
                const params = c.req.valid("param");
                const game = await Sessions.fromSteamID(params.steamID);
                if (!game) return c.json({ error: "Game not found" }, 404);
                return c.json({ data: game }, 200);
            },
        );
}