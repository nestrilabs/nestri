import { Resource } from "sst";
import { defineConfig } from "drizzle-kit";

function addPoolerSuffix(original: string): string {
    const firstDotIndex = original.indexOf('.');
    if (firstDotIndex === -1) return original + '-pooler';
    return original.slice(0, firstDotIndex) + '-pooler' + original.slice(firstDotIndex);
  }

const dbHost = addPoolerSuffix(Resource.Database.host)

export default defineConfig({
    schema: "./src/**/*.sql.ts",
    out: "./migrations",
    dialect: "postgresql",
    verbose: true,
    dbCredentials: {
        url: `postgresql://${Resource.Database.user}:${Resource.Database.password}@${dbHost}/${Resource.Database.name}?sslmode=require`,
    },
});