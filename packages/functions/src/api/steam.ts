import { Hono } from "hono";
import { notPublic } from "./auth";
import {describeRoute} from "hono-openapi";

export module SteamApi {
    export const route = new Hono()
        .use(notPublic)
        .get("/",
            describeRoute({
                tags:["Steam"],
                summary:"Connect to Steam",
                description:"Connect to this user's Steam account",
            })
        )
}