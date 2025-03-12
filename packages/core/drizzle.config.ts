import { Resource } from "sst";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
    verbose: true,
    strict: true,
    out: "./migrations",
    dialect: "postgresql",
    driver: "aws-data-api",
    schema: "./src/**/*.sql.ts",
    dbCredentials: {
        database: Resource.Postgres.database,
        secretArn: Resource.Postgres.secretArn,
        resourceArn: Resource.Postgres.clusterArn,
    },
});