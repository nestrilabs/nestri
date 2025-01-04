import "zod-openapi/extend";
import { Resource } from "sst";
import { ZodError } from "zod";
import { logger } from "hono/logger";
import { subjects } from "../subjects";
import { VisibleError } from "../error";
import { MachineApi } from "./machine";
import { openAPISpecs } from "hono-openapi";
import { ActorContext } from '@nestri/core/actor';
import { Hono, type MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { createClient } from "@openauthjs/openauth/client";

const auth: MiddlewareHandler = async (c, next) => {
    const client = createClient({
        clientID: "api",
        issuer: Resource.Urls.auth
    });

    const authHeader =
        c.req.query("authorization") ?? c.req.header("authorization");
    if (authHeader) {
        const match = authHeader.match(/^Bearer (.+)$/);
        if (!match || !match[1]) {
            throw new VisibleError(
                "input",
                "auth.token",
                "Bearer token not found or improperly formatted",
            );
        }
        const bearerToken = match[1];

        const result = await client.verify(subjects, bearerToken!);
        if (result.err)
            throw new VisibleError("input", "auth.invalid", "Invalid bearer token");
        if (result.subject.type === "user") {
            return ActorContext.with(
                {
                    type: "user",
                    properties: {
                        userID: result.subject.properties.userID,
                        accessToken: result.subject.properties.accessToken,
                        auth: {
                            type: "oauth",
                            clientID: result.aud,
                        },
                    },
                },
                next,
            );
        } else if (result.subject.type === "device") {
            return ActorContext.with(
                {
                    type: "device",
                    properties: {
                        fingerprint: result.subject.properties.fingerprint,
                        id: result.subject.properties.id,
                        auth: {
                            type: "oauth",
                            clientID: result.aud,
                        },
                    },
                },
                next,
            );
        }
    }

    return ActorContext.with({ type: "public", properties: {} }, next);
};


const app = new Hono();
app
    .use(logger(), async (c, next) => {
        c.header("Cache-Control", "no-store");
        return next();
    })
    .use(auth);

const routes = app
    .get("/", (c) => c.text("Hello there 👋🏾"))
    .route("/machines", MachineApi.route)
    .onError((error, c) => {
        console.error(error);
        if (error instanceof VisibleError) {
            return c.json(
                {
                    code: error.code,
                    message: error.message,
                },
                error.kind === "auth" ? 401 : 400,
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
                version: "0.0.3",
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