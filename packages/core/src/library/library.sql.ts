import { timestamps, } from "../drizzle/types";
import { steamTable } from "../steam/steam.sql";
import { baseGamesTable } from "../base-game/base-game.sql";
import { pgTable, primaryKey, varchar, } from "drizzle-orm/pg-core";

export const steamLibraryTable = pgTable(
    "game_libraries",
    {
        ...timestamps,
        gameID: varchar("game_id", { length: 255 })
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
            columns: [table.gameID, table.ownerID]
        })
    ],
);