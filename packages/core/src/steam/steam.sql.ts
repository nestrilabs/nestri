import { userTable } from "../user/user.sql";
import { timestamps, ulid, utc } from "../drizzle/types";
import { pgTable, varchar, text, unique, bigint, primaryKey, pgEnum } from "drizzle-orm/pg-core";

export const statusEnum = pgEnum("steam_status", ["new", "pending", "active"])

export const steamTable = pgTable(
    "steam_accounts",
    {
        ...timestamps,
        id: bigint("steam_id", { mode: "bigint" })
            .primaryKey()
            .notNull(),
        userID: ulid("user_id")
            .references(() => userTable.id, {
                onDelete: "cascade",
            }),
        personaName: varchar("persona_name", { length: 255 }).notNull(),
        avatarHash: varchar("avatar_hash", { length: 255 }).notNull(),
        realName: varchar("real_name", { length: 255 }).notNull(),
        status: statusEnum("status").notNull(),
        profileUrl: text("profile_url").notNull(),
        lastSyncedAt: utc("last_synced_at").notNull(),
    }
);

export const steamCredentialsTable = pgTable(
    "steam_account_credentials",
    {
        ...timestamps,
        refreshToken: text("refresh_token")
            .notNull(),
        id: bigint("steam_id", { mode: "bigint" })
            .notNull()
            .references(() => steamTable.id, {
                onDelete: "cascade"
            }),
        username: varchar("username", { length: 255 }).notNull(),
    },
    (table) => [
        unique("idx_steam_credentials_id").on(table.id),
        primaryKey({
            columns: [table.id]
        })
    ],
)