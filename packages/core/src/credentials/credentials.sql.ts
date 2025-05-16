import { steamTable } from "../steam/steam.sql";
import { pgTable, primaryKey, varchar } from "drizzle-orm/pg-core";
import { encryptedText, ulid, timestamps, utc } from "../drizzle/types";

export const steamCredentialsTable = pgTable(
    "steam_account_credentials",
    {
        ...timestamps,
        id: ulid("id").notNull(),
        steamID: varchar("steam_id", { length: 255 })
            .notNull()
            .references(() => steamTable.id, {
                onDelete: "cascade"
            }),
        refreshToken: encryptedText("refresh_token")
            .notNull(),
        expiry: utc("expiry").notNull(),
        username: varchar("username", { length: 255 }).notNull(),
    },
    (table) => [
        primaryKey({
            columns: [table.steamID, table.id]
        })
    ]
)