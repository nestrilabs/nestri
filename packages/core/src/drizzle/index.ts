export * from "drizzle-orm";
import { Resource } from "sst";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

const client = postgres({
    idle_timeout: 30000,
    connect_timeout: 30000,
    host: Resource.Postgres.host,
    database: Resource.Postgres.database,
    user: Resource.Postgres.username,
    password: Resource.Postgres.password,
    port: Resource.Postgres.port,
    max: parseInt(process.env.POSTGRES_POOL_MAX || "1"),
});

export const db = drizzle(client, {});