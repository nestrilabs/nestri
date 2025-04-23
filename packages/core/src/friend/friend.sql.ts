import { timestamps, } from "../drizzle/types";
import { steamTable } from "../steam/steam.sql";
import { pgTable, bigint, primaryKey } from "drizzle-orm/pg-core";

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
        primaryKey({
            columns: [table.steamID, table.friendSteamID]
        }),
    ]
);