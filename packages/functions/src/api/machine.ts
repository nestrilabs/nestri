import {z} from "zod"
import {Hono} from "hono";
import {notPublic} from "./auth";
import {Result} from "../common";
import {describeRoute} from "hono-openapi";
import {assertActor} from "@nestri/core/actor";
import {Realtime} from "@nestri/core/realtime/index";
import {validator} from "hono-openapi/zod";
import {CreateMessageSchema, StartMessageSchema, StopMessageSchema} from "./messages.ts";

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
    .post("/:machineID/create",
      describeRoute({
        tags: ["Machine"],
        summary: "Request to create a container for a specific machine",
        description: "Publishes a message to create a container via MQTT for the given machine ID",
        responses: {
          200: {
            content: {
              "application/json": {
                schema: Result(
                  z.object({
                    message: z.literal("create request sent"),
                  })
                ),
              },
            },
            description: "Create request successfully sent to MQTT",
          },
          400: {
            content: {
              "application/json": {
                schema: Result(
                  z.object({error: z.string()})
                ),
              },
            },
            description: "Failed to publish create request",
          },
        },
      }),
      validator("json", CreateMessageSchema.shape.payload.optional()), // No payload required for create
      async (c) => {
        const actor = assertActor("machine");
        const body = c.req.valid("json");

        const message = {
          type: "create" as const,
          payload: body || {}, // Empty payload if none provided
        };

        try {
          await Realtime.publish(message, "create");
          console.log("Published create request to");
        } catch (error) {
          console.error("Failed to publish to MQTT:", error);
          return c.json({error: "Failed to send create request"}, 400);
        }

        return c.json({
          data: {
            message: "create request sent",
          },
        }, 200);
      }
    )
    .post("/:machineID/start",
      describeRoute({
        tags: ["Machine"],
        summary: "Request to start a container for a specific machine",
        description: "Publishes a message to start a container via MQTT for the given machine ID",
        responses: {
          200: {
            content: {
              "application/json": {
                schema: Result(
                  z.object({
                    message: z.literal("start request sent"),
                  })
                ),
              },
            },
            description: "Start request successfully sent to MQTT",
          },
          400: {
            content: {
              "application/json": {
                schema: Result(
                  z.object({error: z.string()})
                ),
              },
            },
            description: "Failed to publish start request",
          },
        },
      }),
      validator("json", StartMessageSchema.shape.payload), // Use the payload schema
      async (c) => {
        const actor = assertActor("machine");
        const body = c.req.valid("json");

        const message = {
          type: "start" as const,
          payload: {
            container_id: body.container_id,
          },
        };

        try {
          await Realtime.publish(message, "start");
          console.log("Published start request");
        } catch (error) {
          console.error("Failed to publish to MQTT:", error);
          return c.json({error: "Failed to send start request"}, 400);
        }

        return c.json({
          data: {
            message: "start request sent",
          },
        }, 200);
      }
    )
    .post("/:machineID/stop",
      describeRoute({
        tags: ["Machine"],
        summary: "Request to stop a container for a specific machine",
        description: "Publishes a message to stop a container via MQTT for the given machine ID",
        responses: {
          200: {
            content: {
              "application/json": {
                schema: Result(
                  z.object({
                    message: z.literal("stop request sent"),
                  })
                ),
              },
            },
            description: "Stop request successfully sent to MQTT",
          },
          400: {
            content: {
              "application/json": {
                schema: Result(
                  z.object({error: z.string()})
                ),
              },
            },
            description: "Failed to publish start request",
          },
        },
      }),
      validator("json", StopMessageSchema.shape.payload), // Use the payload schema
      async (c) => {
        const actor = assertActor("machine");
        const body = c.req.valid("json");

        const message = {
          type: "stop" as const,
          payload: {
            container_id: body.container_id,
          },
        };

        try {
          await Realtime.publish(message, "stop");
          console.log("Published stop request");
        } catch (error) {
          console.error("Failed to publish to MQTT:", error);
          return c.json({error: "Failed to send stop request"}, 400);
        }

        return c.json({
          data: {
            message: "stop request sent",
          },
        }, 200);
      }
    )
}