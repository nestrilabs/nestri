import { teamIndexes } from "../team/team.sql";
import { timestamps, utc, teamID } from "../drizzle/types";
import { index, pgEnum, pgTable, text, uniqueIndex, varchar } from "drizzle-orm/pg-core";

export const role = ["admin", "member", "owner"] as const;
const pgRole = pgEnum("role", role)

export const memberTable = pgTable(
    "member",
    {
        ...teamID,
        ...timestamps,
        role: pgRole().notNull(),
        timeSeen: utc("time_seen"),
        email: varchar("email", { length: 255 }).notNull(),
    },
    (table) => [
        ...teamIndexes(table),
        index("email_global").on(table.email),
        uniqueIndex("member_email").on(table.teamID, table.email),
    ],
);