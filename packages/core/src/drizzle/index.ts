export * from "drizzle-orm";
import ws from 'ws';
import { Resource } from "sst";
import {  drizzle as neonDrizzle, NeonDatabase } from "drizzle-orm/neon-serverless";
// import { drizzle } from 'drizzle-orm/postgres-js';
import { Pool, neonConfig } from "@neondatabase/serverless";

neonConfig.webSocketConstructor = ws;

function addPoolerSuffix(original: string): string {
    const firstDotIndex = original.indexOf('.');
    if (firstDotIndex === -1) return original + '-pooler';
    return original.slice(0, firstDotIndex) + '-pooler' + original.slice(firstDotIndex);
  }

const dbHost = addPoolerSuffix(Resource.Database.host)

const client = new Pool({ connectionString: `postgres://${Resource.Database.user}:${Resource.Database.password}@${dbHost}/${Resource.Database.name}?sslmode=require` })

export const db = neonDrizzle(client, {
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