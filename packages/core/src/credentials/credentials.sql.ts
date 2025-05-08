import { steamTable } from "../steam/steam.sql";
import { pgTable, varchar } from "drizzle-orm/pg-core";
import { encryptedText, timestamps, utc } from "../drizzle/types";

export const steamCredentialsTable = pgTable(
    "steam_account_credentials",
    {
        ...timestamps,
        id: varchar("steam_id", { length: 255 })
            .notNull()
            .primaryKey()
            .references(() => steamTable.id, {
                onDelete: "cascade"
            }),
        refreshToken: encryptedText("refresh_token")
            .notNull(),
        expiry: utc("expiry").notNull(),
        username: varchar("username", { length: 255 }).notNull(),
    }
)