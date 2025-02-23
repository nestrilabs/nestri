export * from "drizzle-orm";
import { Resource } from "sst";
import { Client } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";

const client = new Client({
    host: Resource.Database.host,
    user: Resource.Database.user,
    password: Resource.Database.password,
    database: Resource.Database.name
});

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