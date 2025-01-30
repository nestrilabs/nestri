import { z } from "zod";
import { Hono } from "hono";
import { Result } from "../common";
import { describeRoute } from "hono-openapi";
import { Tasks } from "@nestri/core/task/index";
import { Examples } from "@nestri/core/examples";
import { validator, resolver } from "hono-openapi/zod";
import { useCurrentUser } from "@nestri/core/actor";

export module TaskApi {
    export const route = new Hono()
        .get("/:id",
            describeRoute({
                tags: ["Task"],
                summary: "Get",
                description: "Get a task by its id",
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(
                                    Tasks.Info.openapi({
                                        description: "A task example gotten from this task id",
                                        example: Examples.Task,
                                    }))
                            },
                        },
                        description: "A task with this id was found",
                    },
                    404: {
                        content: {
                            "application/json": {
                                schema: resolver(z.object({ error: z.string() })),
                            },
                        },
                        description: "A task with this id was not found.",
                    },
                },
            }),
            validator(
                "param",
                z.object({
                    id: Tasks.Info.shape.id.openapi({
                        description: "ID of the task to get",
                        example: Examples.Task.id,
                    }),
                }),
            ),
            async (c) => {
                const param = c.req.valid("param");
                const task = await Tasks.fromID(param.id);
                if (!task) return c.json({ error: "Task was not found" }, 404);
                return c.json({ data: task }, 200);
            },
        )
        .delete("/:id",
            describeRoute({
                tags: ["Task"],
                summary: "Stop",
                description: "Stop a running task by its id",
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(z.literal("ok"))
                            },
                        },
                        description: "A task with this id was found",
                    },
                    404: {
                        content: {
                            "application/json": {
                                schema: resolver(z.object({ error: z.string() })),
                            },
                        },
                        description: "A task with this id was not found.",
                    },
                },
            }),
            validator(
                "param",
                z.object({
                    id: Tasks.Info.shape.id.openapi({
                        description: "ID of the task to get",
                        example: Examples.Task.id,
                    }),
                }),
            ),
            async (c) => {
                const param = c.req.valid("param");
                const task = await Tasks.fromID(param.id);
                if (!task) return c.json({ error: "Task was not found" }, 404);
                const res = await Tasks.remove(param.id)
                return c.json({ data: res }, 200);
            },
        )
        .post("/",
            describeRoute({
                tags: ["Task"],
                summary: "Create",
                description: "Create a task",
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(z.literal("ok"))
                            },
                        },
                        description: "A task with this id was created",
                    },
                    404: {
                        content: {
                            "application/json": {
                                schema: resolver(z.object({ error: z.string() })),
                            },
                        },
                        description: "A task with this id could not be created",
                    },
                    401: {
                        content: {
                            "application/json": {
                                schema: resolver(z.object({ error: z.string() })),
                            },
                        },
                        description: "You are not authorised to do this",
                    },
                },
            }),
            async (c) => {
                const user = useCurrentUser();
                if (user && user.subscription === "Pro") {
                    const task = await Tasks.create();
                    if (!task) return c.json({ error: "Task was not found" }, 404);
                    return c.json({ data: task }, 200);
                }

                return c.json({ error: "You are not authorized to do this" }, 401);
            },
        );
}