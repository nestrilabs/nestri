import "zod-openapi/extend";
import { Hono } from "hono";
import { auth } from "./auth";
import { ZodError } from "zod";
import { logger } from "hono/logger";
import { AccountApi } from "./account";
import { openAPISpecs } from "hono-openapi";
import { VisibleError } from "@nestri/core/error";
import { HTTPException } from "hono/http-exception";
import { handle, streamHandle } from "hono/aws-lambda";


const app = new Hono();
app
    .use(logger(), async (c, next) => {
        c.header("Cache-Control", "no-store");
        return next();
    })
    .use(auth)

const routes = app
    .get("/", (c) => c.text("Hello World!"))
    .route("/account", AccountApi.route)
    .onError((error, c) => {
        console.warn(error);
        if (error instanceof VisibleError) {
            return c.json(
                {
                    code: error.code,
                    message: error.message,
                },
                400
            );
        }
        if (error instanceof ZodError) {
            const e = error.errors[0];
            if (e) {
                return c.json(
                    {
                        code: e?.code,
                        message: e?.message,
                    },
                    400,
                );
            }
        }
        if (error instanceof HTTPException) {
            return c.json(
                {
                    message: error.message,
                },
                error.status,
            );
        }
        return c.json(
            {
                code: "internal",
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
                description:
                    "The Nestri API gives you the power to run your own customized cloud gaming platform.",
                version: "0.3.0",
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

export type Routes = typeof routes;
export const handler = process.env.SST_DEV ? handle(app) : streamHandle(app);