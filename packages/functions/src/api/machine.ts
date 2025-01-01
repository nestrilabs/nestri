import { z } from "zod";
import { Result } from "../common";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { validator, resolver } from "hono-openapi/zod";
import { Examples } from "@nestri/core/examples";
import { Machine } from "@nestri/core/machine/index";

export module MachineApi {
  export const route = new Hono()
    .get(
      "/",
      describeRoute({
        tags: ["Machine"],
        summary: "List machines",
        description: "List the current user's machines.",
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
        if(!machines) return c.json({ error: "This user has no machines." }, 404);
        return c.json({ data: machines }, 200);
      },
    )
    .get(
      "/:id",
      describeRoute({
        tags: ["Machine"],
        summary: "Get machine",
        description: "Get the machine with the given ID.",
        responses: {
          404: {
            content: {
              "application/json": {
                schema: resolver(z.object({ error: z.string() })),
              },
            },
            description: "Machine not found.",
          },
          200: {
            content: {
              "application/json": {
                schema: Result(
                  Machine.Info.openapi({
                    description: "Machine.",
                    example: Examples.Machine,
                  }),
                ),
              },
            },
            description: "Machine.",
          },
        },
      }),
      validator(
        "param",
        z.object({
          id: z.string().openapi({
            description: "ID of the machine to get.",
            example: Examples.Machine.id,
          }),
        }),
      ),
      async (c) => {
        const param = c.req.valid("param");
        const machine = await Machine.fromID(param.id);
        if (!machine) return c.json({ error: "Machine not found." }, 404);
        return c.json({ data: machine }, 200);
      },
    )
    .post(
      "/",
      describeRoute({
        tags: ["Machine"],
        summary: "Create machine",
        description: "Create a machine.",
        responses: {
          200: {
            content: {
              "application/json": {
                schema: Result(z.literal("ok"))
              },
            },
            description: "Machine was created successfully.",
          },
        },
      }),
      validator(
        "json",
        Machine.Info.omit({ id: true, location: true }).openapi({
          description: "Basic machine information.",
          example: Examples.Machine
        }),
      ),
      async (c) => {
        const request = c.req as any
        const location = `${request.cf.country},${request.cf.continent}`
        await Machine.create({ ...c.req.valid("json"), location });
        return c.json({ data: "ok" as const }, 200);
      },
    )
    .delete(
      "/:id",
      describeRoute({
        tags: ["Machine"],
        summary: "Delete machine",
        description: "Delete the machine with the given ID.",
        responses: {
          200: {
            content: {
              "application/json": {
                schema: Result(z.literal("ok")),
              },
            },
            description: "Machine was deleted successfully.",
          },
        },
      }),
      validator(
        "param",
        z.object({
          id: Machine.Info.shape.id.openapi({
            description: "ID of the machine to delete.",
            example: Examples.Machine.id,
          }),
        }),
      ),
      async (c) => {
        const param = c.req.valid("param");
        await Machine.remove(param.id);
        return c.json({ data: "ok" as const }, 200);
      },
    );
}