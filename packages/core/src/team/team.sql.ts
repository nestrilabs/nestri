import {} from "drizzle-orm/postgres-js";
import { timestamps, id } from "../drizzle/types";
import {
  pgTable,
  primaryKey,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const teamTable = pgTable(
  "team",
  {
    ...id,
    ...timestamps,
    slug: varchar("slug", { length: 255 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
  },
  (table) => [uniqueIndex("slug").on(table.slug)],
);

export function teamIndexes(table: any) {
  return [
    primaryKey({
      columns: [table.teamID, table.id],
    }),
  ];
}