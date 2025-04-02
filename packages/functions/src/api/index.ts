import "zod-openapi/extend";
import { Hono } from "hono";
import { auth } from "./auth";
import { TeamApi } from "./team";
import { logger } from "hono/logger";
import { AccountApi } from "./account";
import { openAPISpecs } from "hono-openapi";
import { HTTPException } from "hono/http-exception";
import { ErrorCodes, VisibleError } from "@nestri/core/error";


export const app = new Hono();
app
    .use(logger(), async (c, next) => {
        c.header("Cache-Control", "no-store");
        return next();
    })
    .use(auth)

const routes = app
    .get("/", (c) => c.text("Hello World!"))
    .route("/team", TeamApi.route)
    .route("/account", AccountApi.route)
    .onError((error, c) => {
        console.warn(error);
        if (error instanceof VisibleError) {
            console.error("api error:", error);
            // @ts-expect-error
            return c.json(error.toResponse(), error.statusCode());
        }
        // Handle HTTP exceptions
        if (error instanceof HTTPException) {
            console.error("http error:", error);
            return c.json(
                {
                    type: "validation",
                    code: ErrorCodes.Validation.INVALID_PARAMETER,
                    message: "Invalid request",
                },
                400,
            );
        }
        console.error("unhandled error:", error);
        return c.json(
            {
                type: "internal",
                code: ErrorCodes.Server.INTERNAL_ERROR,
                message: "Internal server error",
            },
            500,
        );
    });


app.get(
    "/doc",
    openAPISpecs(routes, {
        documentation: {
            info: {
                title: "Nestri API",
                description: "The Nestri API gives you the power to run your own customized cloud gaming platform.",
                version: "0.0.1",
            },
            components: {
                securitySchemes: {
                    Bearer: {
                        type: "http",
                        scheme: "bearer",
                        bearerFormat: "JWT",
                    },
                    TeamID: {
                        type: "apiKey",
                        description: "The team ID to use for this query",
                        in: "header",
                        name: "x-nestri-team"
                    },
                },
            },
            security: [{ Bearer: [], TeamID: [] }],
            servers: [
                { description: "Production", url: "https://api.nestri.io" },
            ],
        },
    }),
);


import { patchLogger } from "../log-polyfill";

patchLogger();

export default {
  port: 3001,
  fetch: app.fetch,
};