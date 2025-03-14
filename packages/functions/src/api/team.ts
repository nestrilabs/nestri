import { z } from "zod";
import { Hono } from "hono";
import { notPublic } from "./auth";
import { describeRoute } from "hono-openapi";
import { User } from "@nestri/core/user/index";
import { Team } from "@nestri/core/team/index";
import { Examples } from "@nestri/core/examples";
import { Member } from "@nestri/core/member/index";
import { assertActor, withActor } from "@nestri/core/actor";
import { ErrorResponses, Result, validator } from "./common";

export module TeamApi {
    export const route = new Hono()
        .use(notPublic)
        .get("/",
            describeRoute({
                tags: ["Team"],
                summary: "List teams",
                description: "List the teams associated with the current user",
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(
                                    Team.Info.array().openapi({
                                        description: "List of teams",
                                        example: [Examples.Team]
                                    })
                                ),
                            },
                        },
                        description: "List of teams"
                    },
                }
            }),
            async (c) => {
                return c.json({
                    data: await User.teams()
                }, 200);
            },
        )
        .post("/",
            describeRoute({
                tags: ["Team"],
                summary: "Create a team",
                description: "Create a team for the current user",
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(
                                    z.literal("ok")
                                    // Team.Info.openapi({
                                    //     description: "Team information",
                                    //     example: Examples.Team
                                    // })
                                )
                            }
                        },
                        description: "Team created succesfully"
                    },
                    400: ErrorResponses[400],
                    409: ErrorResponses[409],
                    429: ErrorResponses[429],
                    500: ErrorResponses[500],
                }
            }),
            validator(
                "json",
                Team.create.schema.omit({ id: true }).openapi({
                    description: "Details of the team to create",
                    //@ts-expect-error
                    example: { ...Examples.Team, id: undefined }
                })
            ),
            async (c) => {
                const body = c.req.valid("json")
                const actor = assertActor("user");

                const teamID = await Team.create(body);
                // const team = await Team.fromID(teamID);

                await withActor(
                    {
                        type: "system",
                        properties: {
                            teamID,
                        },
                    },
                    () =>
                        Member.create({
                            first: true,
                            email: actor.properties.email,
                        }),
                );

                // return c.json({ data: team })
                return c.json({ data: "ok" })
            }
        )
}