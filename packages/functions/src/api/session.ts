import { Hono } from "hono";
import { Result } from "../common";
import { describeRoute } from "hono-openapi";
import { Examples } from "@nestri/core/examples";


export module SessionApi {
     export const route = new Hono()
     .get(
           "/",
           describeRoute({
             tags: ["Session"],
             summary: "List active session",
             description: "List the current user's active session.",
             responses: {
               200: {
                 content: {
                   "application/json": {
                     schema: Result(
                       Machine.Info.array().openapi({
                         description: "List of machines.",
                         example: [Examples.Machine],
                       }),
                     ),
                   },
                 },
                 description: "List of machines.",
               },
               404: {
                 content: {
                   "application/json": {
                     schema: resolver(z.object({ error: z.string() })),
                   },
                 },
                 description: "This user has no machines.",
               },
             },
           }),
           async (c) => {
             const machines = await Machine.list();
             if (!machines) return c.json({ error: "This user has no machines." }, 404);
             return c.json({ data: machines }, 200);
           },
         )
}