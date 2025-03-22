import { } from "drizzle-orm/postgres-js";
import { timestamps, id } from "../drizzle/types";
import {
  varchar,
  pgTable,
  primaryKey,
  uniqueIndex,
  text
} from "drizzle-orm/pg-core";

export const PlanType = ["Hosted", "BYOG"] as const;

export const teamTable = pgTable(
  "team",
  {
    ...id,
    ...timestamps,
    name: varchar("name", { length: 255 }).notNull(),
    slug: varchar("slug", { length: 255 }).notNull(),
    planType: text("plan_type", { enum: PlanType }).notNull()
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