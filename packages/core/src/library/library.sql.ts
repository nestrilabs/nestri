import { timestamps, } from "../drizzle/types";
import { steamTable } from "../steam/steam.sql";
import { baseGamesTable } from "../base-game/base-game.sql";
import { index, pgTable, primaryKey, varchar, } from "drizzle-orm/pg-core";

//TODO: Add playtime here
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
    },
    (table) => [
        primaryKey({
            columns: [table.baseGameID, table.ownerID]
        }),
        index("idx_game_libraries_owner_id").on(table.ownerID),
    ],
);