import { gameTable } from "../game/game.sql";
import { timestamps, } from "../drizzle/types";
import { steamTable } from "../steam/steam.sql";
import { pgTable, bigint, primaryKey, } from "drizzle-orm/pg-core";

export const steamLibraryTable = pgTable(
    "steam_library",
    {
        ...timestamps,
        gameID: bigint("game_id", { mode: "number" })
            .notNull()
            .references(() => gameTable.appID, {
                onDelete: "cascade"
            }),
        steamID: bigint("steam_id", { mode: "bigint" })
            .notNull()
            .references(() => steamTable.steamID, {
                onDelete: "cascade"
            }),
    },
    (table) => [
        primaryKey({
            columns: [table.gameID, table.steamID]
        })
    ],
);