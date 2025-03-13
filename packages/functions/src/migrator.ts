import { db } from "@nestri/core/drizzle/index";
import { migrate } from "drizzle-orm/postgres-js/migrator";

export const handler = async (event: any) => {
  await migrate(db, {
    migrationsFolder: "./migrations",
  });
};