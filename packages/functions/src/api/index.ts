import "zod-openapi/extend";
import { Hono, type MiddlewareHandler } from "hono";
import { Resource } from "sst";
import { logger } from "hono/logger";
import { subjects } from "../subjects";
import { createClient } from "@openauthjs/openauth/client";
import { ZodError } from "zod";
import { VisibleError } from "./error";
import { HTTPException } from "hono/http-exception";

// const client = createClient({
//     clientID: "api",
//     issuer: Resource.Auth.url,
// });

const app = new Hono();
app
    .use(logger(), async (c, next) => {
        c.header("Cache-Control", "no-store");
        return next();
    })
//   .use(auth);

const routes = app
    .get("/", (c) => c.text("Hello there 👋🏾"))
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