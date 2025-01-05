import "zod-openapi/extend";
import { Hono } from "hono";
import { logger } from "hono/logger";
import type { HonoBindings } from "./types";
import { ApiSession } from "./session";
import { openAPISpecs } from "hono-openapi";

const app = new Hono<{ Bindings: HonoBindings }>().basePath('/parties/main/:room');

app
  .use(logger(), async (c, next) => {
    c.header("Cache-Control", "no-store");
    try {
      await next();
    } catch (e: any) {
      return c.json(
        {
          error: {
            message: e.message || "Internal Server Error",
            status: e.status || 500,
          },
        },
        e.status || 500
      );
    }
  })

const routes = app
  .get("/health", (c) => {
    return c.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
    });
  })
  .route("/session", ApiSession.route)

app.get(
  "/doc",
  openAPISpecs(routes, {
    documentation: {
      info: {
        title: "Nestri Realtime API",
        description:
          "The Nestri realtime API gives you the power to connect to your remote machine and relays from a single station",
        version: "0.0.1",
      },
      components: {
        securitySchemes: {
          Bearer: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
          },
        },
      },
      security: [{ Bearer: [] }],
      servers: [
        { description: "Production", url: "https://api.nestri.io" },
      ],
    },
  }),
);

export type Routes = typeof routes;
export default app