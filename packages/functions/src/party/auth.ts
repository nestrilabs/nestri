import { z } from "zod";
import { Hono } from "hono";
import { Result } from "../common"
import { describeRoute } from "hono-openapi";
import type * as Party from "partykit/server";
import { validator, resolver } from "hono-openapi/zod";


export module AuthApi {
    export const route = new Hono()
        .get("/:connection",
            describeRoute({
                tags: ["Auth"],
                summary: "Authenticate the remote device",
                description: "This is a callback function to authenticate the remote device.",
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(z.literal("Device authenticated successfully"))
                            },
                        },
                        description: "Authentication successful.",
                    },
                    404: {
                        content: {
                            "application/json": {
                                schema: resolver(z.object({ error: z.string() })),
                            },
                        },
                        description: "This device does not exist.",
                    },
                },
            }),
            async (c) => {
                const params = c.req.param();
                const env = c.env as any
                const room = env.room as Party.Room

                const connection = room.getConnection(params.connection)
                if(!connection){
                    return c.json({ error: "This device does not exist." }, 404);
                }

                return c.text(`Connections: ${connection.id}`)
            }
        )
}