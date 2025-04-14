import { Hono } from "hono";

export namespace Subscription {
    export const route = new Hono()
        .get("/",

            (c) => {
                return c.text("Subscription API");
            })
}