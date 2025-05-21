import { steamTable } from "../steam/steam.sql";
import { timestamps, utc, } from "../drizzle/types";
import { baseGamesTable } from "../base-game/base-game.sql";
import { index, integer, pgTable, primaryKey, varchar, } from "drizzle-orm/pg-core";

export const steamLibraryTable = pgTable(
    "game_libraries",
    {
        ...timestamps,
        baseGameID: varchar("base_game_id", { length: 255 })
            .notNull()
            .references(() => baseGamesTable.id, {
                onDelete: "cascade"
            }),
        ownerSteamID: varchar("owner_steam_id", { length: 255 })
            .notNull()
            .references(() => steamTable.id, {
                onDelete: "cascade"
            }),
        lastPlayed: utc("last_played"),
        totalPlaytime: integer("total_playtime").notNull(),
    },
    (table) => [
        primaryKey({
            columns: [table.baseGameID, table.ownerSteamID]
        }),
        index("idx_game_libraries_owner_id").on(table.ownerSteamID),
    ],
);