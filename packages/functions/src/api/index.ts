import "zod-openapi/extend";
import { Resource } from "sst";
import { ZodError } from "zod";
import { logger } from "hono/logger";
import { VisibleError } from "./error";
import { subjects } from "../subjects";
import { ActorContext } from '@nestri/core/actor';
import { Hono, type MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { createClient } from "@openauthjs/openauth/client";

const client = () => createClient({
    clientID: "api",
    issuer: Resource.Urls.auth
});

const auth: MiddlewareHandler = async (c, next) => {
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

        const result = await client().verify(subjects, bearerToken!);
        if (result.err)
            throw new VisibleError("input", "auth.invalid", "Invalid bearer token");
        if (result.subject.type === "user") {
            return ActorContext.with(
                {
                    type: "user",
                    properties: {
                        accessToken: result.subject.properties.accessToken,
                        userID: result.subject.properties.userID,
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
}

const app = new Hono();
app
    .use(logger(), async (c, next) => {
        c.header("Cache-Control", "no-store");
        return next();
    })
    .use(auth);

const routes = app
    // .get("/", (c) => c.text("Hello there 👋🏾"))
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

export type Routes = typeof routes;
export default app