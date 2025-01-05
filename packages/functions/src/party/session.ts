import { z } from "zod";
import { Hono } from "hono";
import { Result } from "../common"
import { describeRoute } from "hono-openapi";
import type { HonoBindings, WSMessage } from "./types";
import { validator, resolver } from "hono-openapi/zod";

export module ApiSession {
    export const route = new Hono<{ Bindings: HonoBindings }>()
        .post("/:sessionID/start",
            describeRoute({
                tags: ["Session"],
                summary: "Start a session",
                description: "Start a session on this machine",
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(z.object({
                                    success: z.boolean(),
                                    message: z.string(),
                                    sessionID: z.string()
                                }))
                            },
                        },
                        description: "Session started successfully",
                    },
                    500: {
                        content: {
                            "application/json": {
                                schema: resolver(z.object({ error: z.string(), details: z.string() })),
                            },
                        },
                        description: "There was a problem trying to start your session",
                    },
                },
            }),
            validator(
                "param",
                z.object({
                    sessionID: z.string().openapi({
                        description: "The session ID to start",
                        example: "18d8b4b5-29ba-4a62-8cf9-7059449907a7",
                    }),
                }),
            ),
            async (c) => {
                const param = c.req.valid("param");
                const room = c.env.room

                const message: WSMessage = {
                    type: "START_GAME",
                    sessionID: param.sessionID,
                };

                try {

                    room.broadcast(JSON.stringify(message));

                    return c.json({
                        success: true,
                        message: "Game start signal sent",
                        "sessionID": param.sessionID,
                    });

                } catch (error: any) {
                    return c.json(
                        {
                            error: {
                                message: "Failed to start game session",
                                details: error.message,
                            },
                        },
                        500
                    );
                }
            }
        )
        .post("/:sessionID/end",
            describeRoute({
                tags: ["Session"],
                summary: "End a session",
                description: "End a session on this machine",
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(z.object({
                                    success: z.boolean(),
                                    message: z.string(),
                                    sessionID: z.string()
                                }))
                            },
                        },
                        description: "Session successfully ended",
                    },
                    500: {
                        content: {
                            "application/json": {
                                schema: resolver(z.object({ error: z.string(), details: z.string() })),
                            },
                        },
                        description: "There was a problem trying to end your session",
                    },
                },
            }),
            validator(
                "param",
                z.object({
                    sessionID: z.string().openapi({
                        description: "The session ID to end",
                        example: "18d8b4b5-29ba-4a62-8cf9-7059449907a7",
                    }),
                }),
            ),
            async (c) => {
                const param = c.req.valid("param");
                const room = c.env.room

                const message: WSMessage = {
                    type: "END_GAME",
                    sessionID: param.sessionID,
                };

                try {

                    room.broadcast(JSON.stringify(message));

                    return c.json({
                        success: true,
                        message: "Game end signal sent",
                        "sessionID": param.sessionID,
                    });

                } catch (error: any) {
                    return c.json(
                        {
                            error: {
                                message: "Failed to end game session",
                                details: error.message,
                            },
                        },
                        500
                    );
                }
            }
        )
        .post("/:sessionID/status",
            describeRoute({
                tags: ["Session"],
                summary: "Get the status of a session",
                description: "Get the status of a session on this machine",
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(z.object({
                                    success: z.boolean(),
                                    message: z.string(),
                                    sessionID: z.string()
                                }))
                            },
                        },
                        description: "Session status query was successful"
                    },
                    500: {
                        content: {
                            "application/json": {
                                schema: resolver(z.object({ error: z.string(), details: z.string() })),
                            },
                        },
                        description: "There was a problem trying to querying the status of your session",
                    },
                },
            }),
            validator(
                "param",
                z.object({
                    sessionID: z.string().openapi({
                        description: "The session ID to query",
                        example: "18d8b4b5-29ba-4a62-8cf9-7059449907a7",
                    }),
                }),
            ),
            async (c) => {
                const param = c.req.valid("param");
                const room = c.env.room

                const message: WSMessage = {
                    type: "END_GAME",
                    sessionID: param.sessionID,
                };

                try {

                    room.broadcast(JSON.stringify(message));

                    return c.json({
                        success: true,
                        message: "Game end signal sent",
                        "sessionID": param.sessionID,
                    });

                } catch (error: any) {
                    return c.json(
                        {
                            error: {
                                message: "Failed to end game session",
                                details: error.message,
                            },
                        },
                        500
                    );
                }
            }
        )
}