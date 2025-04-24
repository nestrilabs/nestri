import "zod-openapi/extend";
import { auth } from "./auth";
import { cors } from "hono/cors";
import { GameApi } from "./game";
import { TeamApi } from "./team";
import { PolarApi } from "./polar";
import { SteamApi } from "./steam";
import { logger } from "hono/logger";
import { FriendApi } from "./friend";
import { Hono, type Env } from "hono";
import { Realtime } from "./realtime";
import { AccountApi } from "./account";
import { MachineApi } from "./machine";
import { openAPISpecs } from "hono-openapi";
import { patchLogger } from "../log-polyfill";
import { HTTPException } from "hono/http-exception";
import { ErrorCodes, VisibleError } from "@nestri/core/error";

export const app = new Hono();
app
    .use(logger())
    .use(cors())
    .use(async (c, next) => {
        c.header("Cache-Control", "no-store");
        return next();
    })
    .use(auth)

const routes = app
    .get("/", (c) => c.text("Hello World!"))
    .route("/realtime", Realtime.route)
    .route("/team", TeamApi.route)
    .route("/polar", PolarApi.route)
    .route("/friend", FriendApi.route)
    .route("/game", GameApi.route)
    .route("/steam", SteamApi.route)
    .route("/account", AccountApi.route)
    .route("/machine", MachineApi.route)
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
                        description: "The team ID to use for this query",
                        in: "header",
                        name: "x-nestri-team"
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

export type App = typeof app;

patchLogger();

export default {
    port: 3001,
    idleTimeout: 255,
    webSocket: Realtime.webSocketHandler,
    fetch: (req: Request, env: Env) =>
        app.fetch(req, env, {
            waitUntil: (fn) => fn,
            passThroughOnException: () => { },
        }),
};