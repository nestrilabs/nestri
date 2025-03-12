import { db } from "@nestri/core/drizzle/index";
import { migrate } from "drizzle-orm/aws-data-api/pg/migrator";

export const handler = async (event: any) => {
  await migrate(db, {
    migrationsFolder: "./migrations",
  });
};