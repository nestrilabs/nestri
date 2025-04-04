import { timestamps, userID } from "../drizzle/types";
import { index, pgTable, uniqueIndex, varchar, text, primaryKey } from "drizzle-orm/pg-core";

export const steamTable = pgTable(
    "steam",
    {
        ...userID,
        ...timestamps,
        avatarUrl: text("avatar_url").notNull(),
        accessToken: text("access_token").notNull(),
        email: varchar("email", { length: 255 }).notNull(),
        // steamEmail: varchar("steam_email", { length: 255 }).notNull(),
        country: varchar("country", { length: 255 }).notNull(),
        username: varchar("username", { length: 255 }).notNull(),
        personaName: varchar("persona_name", { length: 255 }).notNull(),
    },
    (table) => [
        primaryKey({
            columns: [table.userID, table.id],
        }),
        index("global_steam_email").on(table.email),
        uniqueIndex("steam_email").on(table.userID, table.email),
    ],
);