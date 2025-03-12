import { Resource } from "sst";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
    verbose: true,
    strict: true,
    out: "./migrations",
    dialect: "postgresql",
    schema: "./src/**/*.sql.ts",
    driver: "aws-data-api",
    dbCredentials: {
        database: Resource.Postgres.database,
        secretArn: Resource.Postgres.secretArn,
        resourceArn: Resource.Postgres.clusterArn,
    },
});