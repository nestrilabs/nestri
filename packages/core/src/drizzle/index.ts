export * from "drizzle-orm";
import { Resource } from "sst";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";

const client = neon(`postgres://${Resource.Database.user}:${Resource.Database.password}@${Resource.Database.host}/${Resource.Database.name}?sslmode=require`)

export const db = drizzle(client, {
    logger:
        process.env.DRIZZLE_LOG === "true"
            ? {
                logQuery(query, params) {
                    console.log("query", query);
                    console.log("params", params);
                },
            }
            : undefined,
});