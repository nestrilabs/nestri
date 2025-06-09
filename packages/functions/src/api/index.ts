import "zod-openapi/extend";
import { Hono } from "hono";
import { GameApi } from "./game";
import { SteamApi } from "./steam";
import { auth } from "./utils/auth";
import { FriendApi } from "./friend";
import { logger } from "hono/logger";
import { AccountApi } from "./account";
import { openAPISpecs } from "hono-openapi";
import { patchLogger } from "../utils/patch-logger";
import { HTTPException } from "hono/http-exception";
import { handle, streamHandle } from "hono/aws-lambda";
import { ErrorCodes, VisibleError } from "@nestri/core/error";

patchLogger();

export const app = new Hono();
app
    .use(logger())
    .use(async (c, next) => {
        c.header("Cache-Control", "no-store");
        return next();
    })
    .use(auth)

const routes = app
    .get("/", (c) => c.text("Hello World!"))
    .route("/games", GameApi.route)
    .route("/steam", SteamApi.route)
    .route("/friends", FriendApi.route)
    .route("/account", AccountApi.route)
    .onError((error, c) => {
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
                error.status,
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
                        description: "The steam ID to use for this query",
                        in: "header",
                        name: "x-nestri-steam"
                    },
                },
            },
            security: [{ Bearer: [], TeamID: [] }],
            servers: [
                { description: "Production", url: "https://api.nestri.io" },
                { description: "Sandbox", url: "https://api.dev.nestri.io" },
            ],
        },
    }),
);

export type Routes = typeof routes;

export const handler = process.env.SST_LIVE ? handle(app) : streamHandle(app);