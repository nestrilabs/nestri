import { z } from "zod";
import { Hono } from "hono";
import { Result } from "../common";
import { describeRoute } from "hono-openapi";
import { Teams } from "@nestri/core/team/index";
import { Users } from "@nestri/core/user/index";
import { Examples } from "@nestri/core/examples";
import { validator, resolver } from "hono-openapi/zod";

export module TeamApi {
    export const route = new Hono()
        .get(
            "/",
            //FIXME: Add a way to filter through query params
            describeRoute({
                tags: ["Team"],
                summary: "Retrieve all teams",
                description: "Returns a list of all teams which the authenticated user is part of",
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(
                                    Teams.Info.array().openapi({
                                        description: "A list of teams associated with the user",
                                        example: [Examples.Team],
                                    }),
                                ),
                            },
                        },
                        description: "Successfully retrieved the list teams",
                    },
                    404: {
                        content: {
                            "application/json": {
                                schema: resolver(z.object({ error: z.string() })),
                            },
                        },
                        description: "No teams found for the authenticated user",
                    },
                },
            }),
            async (c) => {
                const teams = await Teams.list();
                if (!teams) return c.json({ error: "No teams found for this user" }, 404);
                return c.json({ data: teams }, 200);
            },
        )
        .get(
            "/:slug",
            describeRoute({
                tags: ["Team"],
                summary: "Retrieve a team by slug",
                description: "Fetch detailed information about a specific team using its unique slug",
                responses: {
                    404: {
                        content: {
                            "application/json": {
                                schema: resolver(z.object({ error: z.string() })),
                            },
                        },
                        description: "No team found matching the provided slug",
                    },
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(
                                    Teams.Info.openapi({
                                        description: "Detailed information about the requested team",
                                        example: Examples.Team,
                                    }),
                                ),
                            },
                        },
                        description: "Successfully retrieved the team information",
                    },
                },
            }),
            validator(
                "param",
                z.object({
                    slug: Teams.Info.shape.slug.openapi({
                        description: "The unique slug used to identify the team",
                        example: Examples.Team.slug,
                    }),
                }),
            ),
            async (c) => {
                const params = c.req.valid("param");
                const team = await Teams.fromSlug(params.slug);
                if (!team) return c.json({ error: "Team not found" }, 404);
                return c.json({ data: team }, 200);
            },
        )
        .post(
            "/",
            describeRoute({
                tags: ["Team"],
                summary: "Create a team",
                description: "Create a new team for the currently authenticated user, enabling them to invite and play a game together with friends",
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(z.literal("ok"))
                            },
                        },
                        description: "Team successfully created",
                    },
                    404: {
                        content: {
                            "application/json": {
                                schema: resolver(z.object({ error: z.string() })),
                            },
                        },
                        description: "A team with this slug already exists",
                    },
                },
            }),
            validator(
                "json",
                z.object({
                    slug: Teams.Info.shape.slug.openapi({
                        description: "The unique name to be used with this team",
                        example: Examples.Team.slug
                    }),
                    name: Teams.Info.shape.name.openapi({
                        description: "The human readable name to give this team",
                        example: Examples.Team.name
                    })
                })
            ),
            async (c) => {
                const params = c.req.valid("json")
                const team = await Teams.fromSlug(params.slug)
                if (team) return c.json({ error: "A team with this slug already exists" }, 404);
                const res = await Teams.create(params)
                return c.json({ data: res }, 200);
            },
        )
        .delete(
            "/:slug",
            describeRoute({
                tags: ["Team"],
                summary: "Delete a team",
                description: "This endpoint allows a user to delete a team, by providing it's unique slug",
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(z.literal("ok")),
                            },
                        },
                        description: "The team was successfully deleted.",
                    },
                    404: {
                        content: {
                            "application/json": {
                                schema: resolver(z.object({ error: z.string() })),
                            },
                        },
                        description: "A team with this slug does not exist",
                    },
                    401: {
                        content: {
                            "application/json": {
                                schema: resolver(z.object({ error: z.string() })),
                            },
                        },
                        description: "Your are not authorized to delete this team",
                    },
                }
            }),
            validator(
                "param",
                z.object({
                    slug: Teams.Info.shape.slug.openapi({
                        description: "The unique slug of the team to be deleted. ",
                        example: Examples.Team.slug,
                    }),
                }),
            ),
            async (c) => {
                const params = c.req.valid("param");
                const team = await Teams.fromSlug(params.slug)
                if (!team) return c.json({ error: "Team not found" }, 404);
                // if (!team.owner) return c.json({ error: "Your are not authorised to delete this team" }, 401)
                const res = await Teams.remove(team.id);
                return c.json({ data: res }, 200);
            },
        )
        .post(
            "/:slug/invite/:email",
            describeRoute({
                tags: ["Team"],
                summary: "Invite a user to a team",
                description: "Invite a user to a team owned by the current user",
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(z.literal("ok")),
                            },
                        },
                        description: "User successfully invited",
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
                    slug: Teams.Info.shape.slug.openapi({
                        description: "The unique slug of the team the user wants to invite ",
                        example: Examples.Team.slug,
                    }),
                    email: Users.Info.shape.email.openapi({
                        description: "The email of the user to invite",
                        example: Examples.User.email
                    })
                }),
            ),
            async (c) => {
                const params = c.req.valid("param");
                const team = await Teams.fromSlug(params.slug)
                if (!team) return c.json({ error: "Team not found" }, 404);
                // if (!team.owner) return c.json({ error: "Your are not authorized to delete this team" }, 401)
                return c.json({ data: "ok" }, 200);
            },
        )
}