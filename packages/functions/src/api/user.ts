import { z } from "zod";
import { Hono } from "hono";
import { Result } from "../common";
import { describeRoute } from "hono-openapi";
import { Examples } from "@nestri/core/examples";
import { Profiles } from "@nestri/core/profile/index";
import { validator, resolver } from "hono-openapi/zod";

export module UserApi {
    export const route = new Hono()
        .get(
            "/@me",
            describeRoute({
                tags: ["User"],
                summary: "Retrieve current user profile",
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
}