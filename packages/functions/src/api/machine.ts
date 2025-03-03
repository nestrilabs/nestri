import { z } from "zod"
import { Hono } from "hono";
import { notPublic } from "./auth";
import { Result } from "../common";
import { describeRoute } from "hono-openapi";
import { assertActor } from "@nestri/core/actor";
import { Realtime } from "@nestri/core/realtime/index";
import { validator } from "hono-openapi/zod";

export module MachineApi {
    export const route = new Hono()
        .use(notPublic)
        .post("/",
            describeRoute({
                tags: ["Machine"],
                summary: "Send messages to the machine",
                description: "Send messages directly to the machine",
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(
                                    z.literal("ok")
                                ),
                            },
                        },
                        description: "Successfully sent the message to Maitred"
                    },
                    // 404: {
                    //     content: {
                    //         "application/json": {
                    //             schema: resolver(z.object({ error: z.string() })),
                    //         },
                    //     },
                    //     description: "This account does not exist",
                    // },
                }
            }),
            validator(
                "json",
                z.any()
            ),
            async (c) => {
                const actor = assertActor("machine");
                console.log("actor.id", actor.properties.machineID)

                await Realtime.publish(c.req.valid("json"))

                return c.json({
                    data: "ok"
                }, 200);
            },
        )
}