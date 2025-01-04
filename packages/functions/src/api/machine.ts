import { z } from "zod";
import { Result } from "../common";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { validator, resolver } from "hono-openapi/zod";
import { Examples } from "@nestri/core/examples";
import { Machines } from "@nestri/core/machine/index";
export module MachineApi {
  export const route = new Hono()
    .get(
      "/",
      //FIXME: Add a way to filter through query params
      describeRoute({
        tags: ["Machine"],
        summary: "Retrieve all machines",
        description: "Returns a list of all machines registered to the authenticated user in the Nestri network",
        responses: {
          200: {
            content: {
              "application/json": {
                schema: Result(
                  Machines.Info.array().openapi({
                    description: "A list of machines associated with the user",
                    example: [Examples.Machine],
                  }),
                ),
              },
            },
            description: "Successfully retrieved the list of machines",
          },
          404: {
            content: {
              "application/json": {
                schema: resolver(z.object({ error: z.string() })),
              },
            },
            description: "No machines found for the authenticated user",
          },
        },
      }),
      async (c) => {
        const machines = await Machines.list();
        if (!machines) return c.json({ error: "No machines found for this user" }, 404);
        return c.json({ data: machines }, 200);
      },
    )
    .get(
      "/:fingerprint",
      describeRoute({
        tags: ["Machine"],
        summary: "Retrieve machine by fingerprint",
        description: "Fetches detailed information about a specific machine using its unique fingerprint derived from the Linux machine ID",
        responses: {
          404: {
            content: {
              "application/json": {
                schema: resolver(z.object({ error: z.string() })),
              },
            },
            description: "No machine found matching the provided fingerprint",
          },
          200: {
            content: {
              "application/json": {
                schema: Result(
                  Machines.Info.openapi({
                    description: "Detailed information about the requested machine",
                    example: Examples.Machine,
                  }),
                ),
              },
            },
            description: "Successfully retrieved machine information",
          },
        },
      }),
      validator(
        "param",
        z.object({
          fingerprint: Machines.Info.shape.fingerprint.openapi({
            description: "The unique fingerprint used to identify the machine, derived from its Linux machine ID",
            example: Examples.Machine.fingerprint,
          }),
        }),
      ),
      async (c) => {
        const params = c.req.valid("param");
        const machine = await Machines.fromFingerprint(params.fingerprint);
        if (!machine) return c.json({ error: "Machine not found" }, 404);
        return c.json({ data: machine }, 200);
      },
    )
    .post(
      "/:fingerprint",
      describeRoute({
        tags: ["Machine"],
        summary: "Register a machine to an owner",
        description: "Associates a machine with the currently authenticated user's account, enabling them to manage and control the machine",
        responses: {
          200: {
            content: {
              "application/json": {
                schema: Result(z.literal("ok"))
              },
            },
            description: "Machine successfully registered to user's account",
          },
          404: {
            content: {
              "application/json": {
                schema: resolver(z.object({ error: z.string() })),
              },
            },
            description: "No machine found matching the provided fingerprint",
          },
        },
      }),
      validator(
        "param",
        z.object({
          fingerprint: Machines.Info.shape.fingerprint.openapi({
            description: "The unique fingerprint of the machine to be registered, derived from its Linux machine ID",
            example: Examples.Machine.fingerprint,
          }),
        }),
      ),
      async (c) => {
        const params = c.req.valid("param")
        const machine = await Machines.fromFingerprint(params.fingerprint)
        if (!machine) return c.json({ error: "Machine not found" }, 404);
        const res = await Machines.linkToCurrentUser({ id: machine.id })
        return c.json({ data: res }, 200);
      },
    )
    .delete(
      "/:fingerprint",
      describeRoute({
        tags: ["Machine"],
        summary: "Unregister machine from user",
        description: "Removes the association between a machine and the authenticated user's account. This does not delete the machine itself, but removes the user's ability to manage it",
        responses: {
          200: {
            content: {
              "application/json": {
                schema: Result(z.literal("ok")),
              },
            },
            description: "Machine successfully unregistered from user's account",
          },
          404: {
            content: {
              "application/json": {
                schema: resolver(z.object({ error: z.string() })),
              },
            },
            description: "The machine with the specified fingerprint was not found",
          },
        }
      }),
      validator(
        "param",
        z.object({
          fingerprint: Machines.Info.shape.fingerprint.openapi({
            description: "The unique fingerprint of the machine to be unregistered, derived from its Linux machine ID",
            example: Examples.Machine.fingerprint,
          }),
        }),
      ),
      async (c) => {
        const params = c.req.valid("param");
        const res = await Machines.unLinkFromCurrentUser({ fingerprint: params.fingerprint })
        if (!res) return c.json({ error: "Machine not found for this user" }, 404);
        return c.json({ data: res }, 200);
      },
    );
}