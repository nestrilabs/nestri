import { Resource } from "sst";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

const client = postgres({
    idle_timeout: 30000,
    connect_timeout: 30000,
    host: Resource.Database.host,
    database: Resource.Database.database,
    user: Resource.Database.username,
    password: Resource.Database.password,
    port: Resource.Database.port,
    max: parseInt(process.env.POSTGRES_POOL_MAX || "1"),
});

export const db = drizzle(client, {});