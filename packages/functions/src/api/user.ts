import { z } from "zod";
import { Hono } from "hono";
import { Result } from "../common";
import { describeRoute } from "hono-openapi";
import { Examples } from "@nestri/core/examples";
import { Profiles } from "@nestri/core/profile/index";
import { validator, resolver } from "hono-openapi/zod";
import { Sessions } from "@nestri/core/session/index";

export module UserApi {
    export const route = new Hono()
        .get(
            "/@me",
            describeRoute({
                tags: ["User"],
                summary: "Retrieve current user's profile",
                description: "Returns the current authenticate user's profile",
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(
                                    Profiles.Info.openapi({
                                        description: "The profile for this user",
                                        example: Examples.Profile,
                                    }),
                                ),
                            },
                        },
                        description: "Successfully retrieved the user's profile",
                    },
                    404: {
                        content: {
                            "application/json": {
                                schema: resolver(z.object({ error: z.string() })),
                            },
                        },
                        description: "No user profile found",
                    },
                },
            }), async (c) => {
                const profile = await Profiles.getCurrentProfile();
                if (!profile) return c.json({ error: "No profile found for this user" }, 404);
                return c.json({ data: profile }, 200);
            },
        )
        .get(
            "/",
            describeRoute({
                tags: ["User"],
                summary: "List all user profiles",
                description: "Returns all user profiles",
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(
                                    Profiles.Info.openapi({
                                        description: "The profiles of all users",
                                        examples: [Examples.Profile],
                                    }),
                                ),
                            },
                        },
                        description: "Successfully retrieved all user profiles",
                    },
                    404: {
                        content: {
                            "application/json": {
                                schema: resolver(z.object({ error: z.string() })),
                            },
                        },
                        description: "No user profiles were found",
                    },
                },
            }), async (c) => {
                const profiles = await Profiles.list();
                if (!profiles) return c.json({ error: "No user profiles were found" }, 404);
                return c.json({ data: profiles }, 200);
            },
        )
        .get(
            "/:id",
            describeRoute({
                tags: ["User"],
                summary: "Retrieve a user's profile",
                description: "Gets a user's profile by their id",
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(
                                    Profiles.Info.openapi({
                                        description: "The profile of the users",
                                        example: Examples.Profile,
                                    }),
                                ),
                            },
                        },
                        description: "Successfully retrieved the user profile",
                    },
                    404: {
                        content: {
                            "application/json": {
                                schema: resolver(z.object({ error: z.string() })),
                            },
                        },
                        description: "No user profile was found",
                    },
                },
            }),
            validator(
                "param",
                z.object({
                    id: Profiles.Info.shape.id.openapi({
                        description: "ID of the user profile to get",
                        example: Examples.Profile.id,
                    }),
                }),
            ),
            async (c) => {
                const param = c.req.valid("param");
                console.log("id", param.id)
                const profiles = await Profiles.fromID(param.id);
                if (!profiles) return c.json({ error: "No user profile was found" }, 404);
                return c.json({ data: profiles }, 200);
            },
        )
        .get(
            "/:id/session",
            describeRoute({
                tags: ["User"],
                summary: "Retrieve a user's active session",
                description: "Get a user's active gaming session details by their id",
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(
                                    Sessions.Info.openapi({
                                        description: "The active session of this user",
                                        example: Examples.Session,
                                    }),
                                ),
                            },
                        },
                        description: "Successfully retrieved the active user gaming session",
                    },
                    404: {
                        content: {
                            "application/json": {
                                schema: resolver(z.object({ error: z.string() })),
                            },
                        },
                        description: "No active gaming session for this user",
                    },
                },
            }),
            validator(
                "param",
                z.object({
                    id: Sessions.Info.shape.id.openapi({
                        description: "ID of the user's gaming session to get",
                        example: Examples.Session.id,
                    }),
                }),
            ),
            async (c) => {
                const param = c.req.valid("param");
                const ownerID = await Profiles.fromIDToOwner(param.id);
                if (!ownerID) return c.json({ error: "We could not get the owner of this profile" }, 404);
                const session = await Sessions.fromOwnerID(ownerID)
                if(!session) return c.json({ error: "This user profile does not have active sessions" }, 404);
                return c.json({ data: session }, 200);
            },
        )
}