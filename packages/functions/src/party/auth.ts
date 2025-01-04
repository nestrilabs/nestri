import { z } from "zod";
import { Hono } from "hono";
import { Result } from "../common"
import { describeRoute } from "hono-openapi";
import type * as Party from "partykit/server";
import { validator, resolver } from "hono-openapi/zod";

const paramsObj = z.object({
    code: z.string(),
    state: z.string()
})

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
            validator(
                "param",
                z.object({
                    connection: z.string().openapi({
                        description: "The hostname of the device to login to.",
                        example: "desktopeuo8vsf",
                    }),
                }),
            ),
            async (c) => {
                const param = c.req.valid("param");
                const env = c.env as any
                const room = env.room as Party.Room


                // const connection = room.getConnection(param.connection)
                // if (!connection) {
                //     return c.json({ error: "This device does not exist." }, 404);
                // }

                // const authParams = getUrlParams(new URL(c.req.url))
                // const res = paramsObj.safeParse(authParams)
                // if (res.error) {
                //     return c.json({ error: "Expected url params are missing" })
                // }

                // connection.send(JSON.stringify({ ...authParams, type: "auth" }))

                // FIXME:We just assume the authentication was successful, might wanna do some questioning in the future
                return c.text("Device authenticated successfully")
            }
        )
}

function getUrlParams(url: URL) {
    const urlString = url.toString()
    const hash = urlString.substring(urlString.indexOf('?') + 1); // Extract the part after the #
    const params = new URLSearchParams(hash);
    const paramsObj = {} as any;
    for (const [key, value] of params.entries()) {
        paramsObj[key] = decodeURIComponent(value);
    }
    return paramsObj;
}