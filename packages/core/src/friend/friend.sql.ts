import { timestamps, } from "../drizzle/types";
import { steamTable } from "../steam/steam.sql";
import { pgTable, uniqueIndex, bigint, primaryKey } from "drizzle-orm/pg-core";

export const friendTable = pgTable(
    "friend",
    {
        ...timestamps,
        steamID: bigint("steam_id", { mode: "bigint" })
            .notNull()
            .references(() => steamTable.steamID, {
                onDelete: "cascade"
            }),
        friendSteamID: bigint("friend_steam_id", { mode: "bigint" })
            .notNull()
            .references(() => steamTable.steamID, {
                onDelete: "cascade"
            }),
    },
    (table) => [
        primaryKey({ columns: [table.steamID, table.friendSteamID] }),
        uniqueIndex("idx_steam_friends_steam_id").on(table.steamID),
        uniqueIndex("idx_steam_friends_friend_steam_id").on(table.friendSteamID),
    ]
);