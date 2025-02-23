import { Resource } from "sst";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
    schema: "./src/**/*.sql.ts",
    out: "./migrations",
    dialect: "postgresql",
    dbCredentials: {
        url: `postgres://${Resource.Database.user}:${Resource.Database.password}@${Resource.Database.host}/${Resource.Database.name}`,
    },
});