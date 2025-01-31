import { z } from "zod";
import { Hono } from "hono";
import { Result } from "../common";
import { describeRoute } from "hono-openapi";
import { Tasks } from "@nestri/core/task/index";
import { Examples } from "@nestri/core/examples";
import { validator, resolver } from "hono-openapi/zod";
import { useCurrentUser } from "@nestri/core/actor";
import { Subscriptions } from "@nestri/core/subscription/index";

export module TaskApi {
    export const route = new Hono()
        .get("/",
            describeRoute({
                tags: ["Task"],
                summary: "List Tasks",
                description: "List all tasks by this user",
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(
                                    Tasks.Info.openapi({
                                        description: "A task example gotten from this task id",
                                        examples: [Examples.Task],
                                    }))
                            },
                        },
                        description: "Tasks owned by this user were found",
                    },
                    404: {
                        content: {
                            "application/json": {
                                schema: resolver(z.object({ error: z.string() })),
                            },
                        },
                        description: "No tasks for this user were not found.",
                    },
                },
            }),
            async (c) => {
                const task = await Tasks.list();
                if (!task) return c.json({ error: "No tasks were found for this user" }, 404);
                return c.json({ data: task }, 200);
            },
        )
        .get("/:id",
            describeRoute({
                tags: ["Task"],
                summary: "Get Task",
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
                summary: "Stop Task",
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
                        description: "The id of the task to get",
                        example: Examples.Task.id,
                    }),
                }),
            ),
            async (c) => {
                const param = c.req.valid("param");
                const task = await Tasks.fromID(param.id);
                if (!task) return c.json({ error: "Task was not found" }, 404);
                const res = await Tasks.stop({ taskID: task[0].taskID, id: param.id })
                return c.json({ data: res }, 200);
            },
        )
        .post("/",
            describeRoute({
                tags: ["Task"],
                summary: "Create Task",
                description: "Create a task",
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(Tasks.Info.shape.id.openapi({
                                    description: "The id of the task created",
                                    example: Examples.Task.id,
                                }))
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
                const data = await Subscriptions.list(undefined);
                if (!data) return c.json({ error: "No subscriptions found for this user" }, 404);
                if (user) {
                    const task = await Tasks.create();
                    if (!task) return c.json({ error: "Task could not be created" }, 404);
                    return c.json({ data: task }, 200);
                }

                return c.json({ error: "You are not authorized to do this" }, 401);
            },
        )
        .put(
            "/:id",
            describeRoute({
                tags: ["Task"],
                summary: "Get an update on a task",
                description: "Updates the metadata about a task by querying remote task",
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(Tasks.Info.openapi({
                                    description: "The updated information about this task",
                                    example: Examples.Task
                                })),
                            },
                        },
                        description: "Task successfully updated",
                    },
                    404: {
                        content: {
                            "application/json": {
                                schema: resolver(z.object({ error: z.string() })),
                            },
                        },
                        description: "The task specified id was not found",
                    },
                }
            }),
            validator(
                "param",
                z.object({
                    id: Tasks.Info.shape.id.openapi({
                        description: "The id of the task to update on",
                        example: Examples.Task.id
                    })
                })
            ),
            async (c) => {
                const params = c.req.valid("param");
                const res = await Tasks.update(params.id)
                if (!res) return c.json({ error: "Something went seriously wrong" }, 404);
                return c.json({ data: res[0] }, 200);
            },
        )
}