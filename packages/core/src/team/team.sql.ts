import { timestamps, id } from "../drizzle/types";
import {
  varchar,
  pgTable,
  primaryKey,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const teamTable = pgTable(
  "team",
  {
    ...id,
    ...timestamps,
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 255 }).notNull(),
  },
  (table) => [
    uniqueIndex("slug").on(table.slug)
  ],
);

export function teamIndexes(table: any) {
  return [
    primaryKey({
      columns: [table.teamID, table.id],
    }),
  ];
}