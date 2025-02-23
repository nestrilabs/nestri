import "zod-openapi/extend";
import { Resource } from "sst";
import { ZodError } from "zod";
// import { UserApi } from "./user";
// import { TaskApi } from "./task";
// import { GameApi } from "./game";
// import { TeamApi } from "./team";
import { logger } from "hono/logger";
import { subjects } from "../subjects";
// import { SessionApi } from "./session";
// import { MachineApi } from "./machine";
import { openAPISpecs } from "hono-openapi";
// import { SubscriptionApi } from "./subscription";
import { VisibleError } from "@nestri/core/error";
// import { ActorContext } from '@nestri/core/actor';
import { Hono, type MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { handle, streamHandle } from "hono/aws-lambda";
import { createClient } from "@openauthjs/openauth/client";
import { auth } from "./auth";


const app = new Hono();
app
    .use(logger(), async (c, next) => {
        c.header("Cache-Control", "no-store");
        return next();
    })
    .use(auth)

const routes = app
    .get("/", (c) => c.text("Hello there 👋🏾"))
    // .route("/users", UserApi.route)
    // .route("/tasks", TaskApi.route)
    // .route("/teams", TeamApi.route)
    // .route("/games", GameApi.route)
    // .route("/sessions", SessionApi.route)
    // .route("/machines", MachineApi.route)
    // .route("/subscriptions", SubscriptionApi.route)
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
                    code: "request",
                    message: "Invalid request",
                },
                400,
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
export const handler = process.env.SST_DEV ? handle(app) : streamHandle(app);