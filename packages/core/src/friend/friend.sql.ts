import { timestamps, } from "../drizzle/types";
import { steamTable } from "../steam/steam.sql";
import { index, pgTable, primaryKey, varchar } from "drizzle-orm/pg-core";

export const friendTable = pgTable(
    "friends_list",
    {
        ...timestamps,
        steamID: varchar("steam_id", { length: 255 })
            .notNull()
            .references(() => steamTable.id, {
                onDelete: "cascade"
            }),
        friendSteamID: varchar("friend_steam_id", { length: 255 })
            .notNull()
            .references(() => steamTable.id, {
                onDelete: "cascade"
            }),
    },
    (table) => [
        primaryKey({
            columns: [table.steamID, table.friendSteamID]
        }),
        index("idx_friends_list_friend_steam_id").on(table.friendSteamID),
    ]
);