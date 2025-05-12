import { timestamps, utc, } from "../drizzle/types";
import { steamTable } from "../steam/steam.sql";
import { baseGamesTable } from "../base-game/base-game.sql";
import { boolean, index, integer, pgTable, primaryKey, varchar, } from "drizzle-orm/pg-core";

export const steamLibraryTable = pgTable(
    "game_libraries",
    {
        ...timestamps,
        baseGameID: varchar("base_game_id", { length: 255 })
            .notNull()
            .references(() => baseGamesTable.id, {
                onDelete: "cascade"
            }),
        ownerID: varchar("owner_id", { length: 255 })
            .notNull()
            .references(() => steamTable.id, {
                onDelete: "cascade"
            }),
        timeAcquired: utc("time_acquired").notNull(),
        lastPlayed: utc("last_played").notNull(),
        totalPlaytime: integer("total_playtime").notNull(),
        isFamilyShared: boolean("is_family_shared").notNull()
    },
    (table) => [
        primaryKey({
            columns: [table.baseGameID, table.ownerID]
        }),
        index("idx_game_libraries_owner_id").on(table.ownerID),
    ],
);