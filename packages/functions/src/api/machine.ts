// import { z } from "zod"
// import { Hono } from "hono";
// import { notPublic } from "./auth";
// import { describeRoute } from "hono-openapi";
// import { validator } from "hono-openapi/zod";
// import { Examples } from "@nestri/core/examples";
// import { assertActor } from "@nestri/core/actor";
// import { ErrorResponses, Result } from "./common";
// import { Machine } from "@nestri/core/machine/index";
// import { Realtime } from "@nestri/core/realtime/index";
// import { ErrorCodes, VisibleError } from "@nestri/core/error";
// import { CreateMessageSchema, StartMessageSchema, StopMessageSchema } from "./messages.ts";

// export namespace MachineApi {
//   export const route = new Hono()
//     .use(notPublic)
//     .get("/",
//       describeRoute({
//         tags: ["Machine"],
//         summary: "Get all BYOG machines",
//         description: "All the BYOG machines owned by this user",
//         responses: {
//           200: {
//             content: {
//               "application/json": {
//                 schema: Result(
//                   Machine.Info.array().openapi({
//                     description: "All the user's BYOG machines",
//                     example: [Examples.Machine],
//                   }),
//                 ),
//               },
//             },
//             description: "Successfully retrieved all the user's machines",
//           },
//           404: ErrorResponses[404],
//           429: ErrorResponses[429]
//         }
//       }),
//       async (c) => {
//         const user = assertActor("user");
//         const machineInfo = await Machine.fromUserID(user.properties.userID);

//         if (!machineInfo)
//           throw new VisibleError(
//             "not_found",
//             ErrorCodes.NotFound.RESOURCE_NOT_FOUND,
//             "No machines not found",
//           );

//         return c.json({ data: machineInfo, }, 200);

//       })
//     .get("/hosted",
//       describeRoute({
//         tags: ["Machine"],
//         summary: "Get all cloud machines",
//         description: "All the machines that are connected to Nestri",
//         responses: {
//           200: {
//             content: {
//               "application/json": {
//                 schema: Result(
//                   Machine.Info.array().openapi({
//                     description: "All the machines connected to Nestri",
//                     example: [{ ...Examples.Machine, userID: null }],
//                   }),
//                 ),
//               },
//             },
//             description: "Successfully retrieved all the hosted machines",
//           },
//           404: ErrorResponses[404],
//           429: ErrorResponses[429]
//         }
//       }),
//       async (c) => {
//         const machineInfo = await Machine.list();

//         if (!machineInfo)
//           throw new VisibleError(
//             "not_found",
//             ErrorCodes.NotFound.RESOURCE_NOT_FOUND,
//             "No machines not found",
//           );

//         return c.json({ data: machineInfo, }, 200);

//       })
//     .post("/",
//       describeRoute({
//         tags: ["Machine"],
//         summary: "Send messages to the machine",
//         description: "Send messages directly to the machine",
//         responses: {
//           200: {
//             content: {
//               "application/json": {
//                 schema: Result(
//                   z.literal("ok")
//                 ),
//               },
//             },
//             description: "Successfully sent the message to Maitred"
//           },
//         }
//       }),
//       validator(
//         "json",
//         z.any()
//       ),
//       async (c) => {
//         const actor = assertActor("machine");
//         console.log("actor.id", actor.properties.machineID)

//         await Realtime.publish(c.req.valid("json"))

//         return c.json({
//           data: "ok"
//         }, 200);
//       },
//     )
//     .post("/:machineID/create",
//       describeRoute({
//         tags: ["Machine"],
//         summary: "Request to create a container for a specific machine",
//         description: "Publishes a message to create a container via MQTT for the given machine ID",
//         responses: {
//           200: {
//             content: {
//               "application/json": {
//                 schema: Result(
//                   z.object({
//                     message: z.literal("create request sent"),
//                   })
//                 ),
//               },
//             },
//             description: "Create request successfully sent to MQTT",
//           },
//           400: {
//             content: {
//               "application/json": {
//                 schema: Result(
//                   z.object({ error: z.string() })
//                 ),
//               },
//             },
//             description: "Failed to publish create request",
//           },
//         },
//       }),
//       validator("json", CreateMessageSchema.shape.payload.optional()), // No payload required for create
//       async (c) => {
//         const actor = assertActor("machine");
//         const body = c.req.valid("json");

//         const message = {
//           type: "create" as const,
//           payload: body || {}, // Empty payload if none provided
//         };

//         try {
//           await Realtime.publish(message, "create");
//           console.log("Published create request to");
//         } catch (error) {
//           console.error("Failed to publish to MQTT:", error);
//           return c.json({ error: "Failed to send create request" }, 400);
//         }

//         return c.json({
//           data: {
//             message: "create request sent",
//           },
//         }, 200);
//       }
//     )
//     .post("/:machineID/start",
//       describeRoute({
//         tags: ["Machine"],
//         summary: "Request to start a container for a specific machine",
//         description: "Publishes a message to start a container via MQTT for the given machine ID",
//         responses: {
//           200: {
//             content: {
//               "application/json": {
//                 schema: Result(
//                   z.object({
//                     message: z.literal("start request sent"),
//                   })
//                 ),
//               },
//             },
//             description: "Start request successfully sent to MQTT",
//           },
//           400: {
//             content: {
//               "application/json": {
//                 schema: Result(
//                   z.object({ error: z.string() })
//                 ),
//               },
//             },
//             description: "Failed to publish start request",
//           },
//         },
//       }),
//       validator("json", StartMessageSchema.shape.payload), // Use the payload schema
//       async (c) => {
//         const actor = assertActor("machine");
//         const body = c.req.valid("json");

//         const message = {
//           type: "start" as const,
//           payload: {
//             container_id: body.container_id,
//           },
//         };

//         try {
//           await Realtime.publish(message, "start");
//           console.log("Published start request");
//         } catch (error) {
//           console.error("Failed to publish to MQTT:", error);
//           return c.json({ error: "Failed to send start request" }, 400);
//         }

//         return c.json({
//           data: {
//             message: "start request sent",
//           },
//         }, 200);
//       }
//     )
//     .post("/:machineID/stop",
//       describeRoute({
//         tags: ["Machine"],
//         summary: "Request to stop a container for a specific machine",
//         description: "Publishes a message to stop a container via MQTT for the given machine ID",
//         responses: {
//           200: {
//             content: {
//               "application/json": {
//                 schema: Result(
//                   z.object({
//                     message: z.literal("stop request sent"),
//                   })
//                 ),
//               },
//             },
//             description: "Stop request successfully sent to MQTT",
//           },
//           400: {
//             content: {
//               "application/json": {
//                 schema: Result(
//                   z.object({ error: z.string() })
//                 ),
//               },
//             },
//             description: "Failed to publish start request",
//           },
//         },
//       }),
//       validator("json", StopMessageSchema.shape.payload), // Use the payload schema
//       async (c) => {
//         const actor = assertActor("machine");
//         const body = c.req.valid("json");

//         const message = {
//           type: "stop" as const,
//           payload: {
//             container_id: body.container_id,
//           },
//         };

//         try {
//           await Realtime.publish(message, "stop");
//           console.log("Published stop request");
//         } catch (error) {
//           console.error("Failed to publish to MQTT:", error);
//           return c.json({ error: "Failed to send stop request" }, 400);
//         }

//         return c.json({
//           data: {
//             message: "stop request sent",
//           },
//         }, 200);
//       }
//     )
// }