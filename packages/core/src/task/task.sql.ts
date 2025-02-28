import { id, timestamps } from "../drizzle/types";
import { pgTable, point, text, uniqueIndex, varchar } from "drizzle-orm/pg-core";

//TODO: Someday we should support fine-grained setup with vCores, RAM, and GPU type for each task
// This needs to be done ASAP, come to think of it
export const taskTable = pgTable(
    "task",
    {
        ...id,
        ...timestamps,
        country: text('country').notNull(),
        timezone: text('timezone').notNull(),
        location: point('location', { mode: 'xy' }).notNull(),
        fingerprint: varchar('fingerprint', { length: 32 }).notNull(),
        countryCode: varchar('country_code', { length: 2 }).notNull(),
    },
    (table) => [
        uniqueIndex("task_fingerprint").on(table.fingerprint),
    ],
);