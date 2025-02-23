import { teamIndexes } from "../team/team.sql";
import { timestamps, utc, teamID } from "../drizzle/types";
import { index, pgTable, uniqueIndex, varchar } from "drizzle-orm/pg-core";

export const member = pgTable(
    "member",
    {
        ...teamID,
        ...timestamps,
        timeSeen: utc("time_seen"),
        email: varchar("email", { length: 255 }).notNull(),
    },
    (table) => [
        ...teamIndexes(table),
        uniqueIndex("email").on(table.teamID, table.email),
        index("email_global").on(table.email),
    ],
);