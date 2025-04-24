import { teamIndexes } from "../team/team.sql";
import { timestamps, utc, teamID } from "../drizzle/types";
import { index, pgTable, text, uniqueIndex, varchar } from "drizzle-orm/pg-core";

export const role = ["admin", "member", "owner"] as const;

export const memberTable = pgTable(
    "member",
    {
        ...teamID,
        ...timestamps,
        timeSeen: utc("time_seen"),
        role: text("role", { enum: role }).notNull(),
        email: varchar("email", { length: 255 }).notNull(),
    },
    (table) => [
        ...teamIndexes(table),
        index("email_global").on(table.email),
        uniqueIndex("member_email").on(table.teamID, table.email),
    ],
);