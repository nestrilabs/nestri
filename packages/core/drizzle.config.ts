import { Resource } from "sst";
import { defineConfig } from "drizzle-kit";

const connection = {
    user: Resource.Postgres.username,
    password: Resource.Postgres.password,
    host: Resource.Postgres.host,
};

export default defineConfig({
    verbose: true,
    strict: true,
    out: "./migrations",
    dialect: "postgresql",
    dbCredentials: {
        url: `postgres://${connection.user}:${connection.password}@${connection.host}/nestri`,
    },
    schema: "./src/**/*.sql.ts",
});