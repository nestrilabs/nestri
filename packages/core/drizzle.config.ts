import { Resource } from "sst";
import { defineConfig } from "drizzle-kit";

console.log("url", `postgresql://${Resource.Database.user}:${Resource.Database.password}@${Resource.Database.host}/${Resource.Database.name}?sslmode=require`)

export default defineConfig({
    schema: "./src/**/*.sql.ts",
    out: "./migrations",
    dialect: "postgresql",
    verbose: true,
    dbCredentials: {
        // url:"postgresql://admin:npg_tnfZ5eX9riRC@ep-withered-bonus-a50o80dp.us-east-2.aws.neon.tech/nestri-lauryn?sslmode=require"
        // url:"postgresql://neondb_owner:npg_5OZFfUogq2YQ@ep-withered-bonus-a50o80dp.us-east-2.aws.neon.tech/neondb?sslmode=require"
        // url: `postgresql://${Resource.Database.user}:${Resource.Database.password}@${Resource.Database.host}/${Resource.Database.name}?sslmode=require`,
        url: "postgresql://admin:npg_tnfZ5eX9riRC@ep-withered-bonus-a50o80dp.us-east-2.aws.neon.tech/neondb?sslmode=require"
        // url: "postgresql://neondb_owner:npg_CrToY1ysGa7N@ep-delicate-bush-a4w4tnmb.us-east-1.aws.neon.tech/neondb?sslmode=require",
    },
});