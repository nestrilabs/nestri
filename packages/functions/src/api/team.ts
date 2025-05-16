import { z } from "zod"
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { Team } from "@nestri/core/team/index";
import { Examples } from "@nestri/core/examples";
import { ErrorResponses, Result, validator } from "./utils";
import { ErrorCodes, VisibleError } from "@nestri/core/error";

export namespace TeamApi {
    export const route = new Hono()
        .get("/",
            describeRoute({
                tags: ["Team"],
                summary: "List user teams",
                description: "List the current user's team details",
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(
                                    Team.Info.array().openapi({
                                        description: "All team information",
                                        example: [Examples.Team]
                                    })
                                ),
                            },
                        },
                        description: "All team details"
                    },
                    400: ErrorResponses[400],
                    404: ErrorResponses[404],
                    429: ErrorResponses[429],
                }
            }),
            async (c) =>
                c.json({
                    data: await Team.list()
                })
        )
        .get("/:slug",
            describeRoute({
                tags: ["Team"],
                summary: "Get team by slug",
                description: "Get the current user's team details, by its slug",
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(
                                    Team.Info.openapi({
                                        description: "Team details",
                                        example: Examples.Team
                                    })
                                ),
                            },
                        },
                        description: "Team details"
                    },
                    400: ErrorResponses[400],
                    404: ErrorResponses[404],
                    429: ErrorResponses[429],
                }
            }),
            validator(
                "param",
                z.object({
                    slug: z.string().openapi({
                        description: "SLug of the team to get",
                        example: Examples.Team.slug,
                    }),
                }),
            ),
            async (c) => {
                const teamSlug = c.req.valid("param").slug

                const team = await Team.fromSlug(teamSlug)

                if (!team) {
                    throw new VisibleError(
                        "not_found",
                        ErrorCodes.NotFound.RESOURCE_NOT_FOUND,
                        `Team ${teamSlug} not found`
                    )
                }

                return c.json({
                    data: team
                })
            }
        )
}