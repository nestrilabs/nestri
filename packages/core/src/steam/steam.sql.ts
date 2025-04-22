import { userTable } from "../user/user.sql";
import { id, timestamps, ulid, } from "../drizzle/types";
import { pgTable, uniqueIndex, varchar, text, primaryKey, unique, bigint } from "drizzle-orm/pg-core";

export const steamTable = pgTable(
    "steam",
    {
        ...id,
        ...timestamps,
        userID: ulid("user_id")
            // Sometimes we will create user's that are not yet on Nestri, because we already know a friend
            // .notNull()
            .references(() => userTable.id, {
                onDelete: "cascade",
            }),
        steamID: bigint("steam_id", { mode: "bigint" }).notNull(),
        avatarHash: varchar("avatar_hash", { length: 255 }).notNull(),
        personaName: varchar("persona_name", { length: 255 }).notNull(),
        realName: varchar("real_name", { length: 255 }).notNull(),
        profileUrl: text("profile_url").notNull(),
    },
    (table) => [
        unique("steam_steam_id").on(table.steamID),
        primaryKey({
            columns: [table.id]
        })
    ],
);

export const steamCredentialsTable = pgTable(
    "steam_credentials",
    {
        ...id,
        ...timestamps,
        refreshToken: text("refresh_token").notNull(),
        steamID: bigint("steam_id", { mode: "bigint" })
            .notNull()
            .references(() => steamTable.steamID, {
                onDelete: "cascade"
            }),
        username: varchar("username", { length: 255 }).notNull(),
    },
    (table) => [
        uniqueIndex("steam_credentials_id").on(table.steamID),
        primaryKey({
            columns: [table.id]
        }),
    ],
)