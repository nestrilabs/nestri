import { z } from "zod";
import { fn } from "../utils";
import { Game } from "../game";
import { createSelectSchema } from "drizzle-zod";
import { steamLibraryTable } from "./library.sql";
import { and, eq, isNull, sql } from "drizzle-orm";
import { groupBy, pipe, values, map } from "remeda";
import { createTransaction, useTransaction } from "../drizzle/transaction";
import { gameGenreRelationTable, gameGenreTable, gameTable } from "../game/game.sql";

export namespace SteamLibrary {
    export const Info = createSelectSchema(steamLibraryTable)
        .omit({ timeCreated: true, timeDeleted: true, timeUpdated: true })

    export type Info = z.infer<typeof Info>;

    export const add = fn(
        Info,
        async (input) =>
            createTransaction(async (tx) => {
                await tx
                    .insert(steamLibraryTable)
                    .values({
                        steamID: input.steamID,
                        gameID: input.gameID
                    })
                    .onConflictDoUpdate({
                        target: [steamLibraryTable.steamID, steamLibraryTable.gameID],
                        set: { timeDeleted: null }
                    })
                return input.steamID
            })
    )

    export const remove = fn(
        Info,
        (input) =>
            useTransaction(async (tx) =>
                tx
                    .update(steamLibraryTable)
                    .set({ timeDeleted: sql`now()` })
                    .where(
                        and(
                            eq(steamLibraryTable.steamID, input.steamID),
                            eq(steamLibraryTable.gameID, input.gameID),
                        )
                    )
            )
    )

    export const fromSteamID = fn(
        Info.pick({ steamID: true }),
        (input) =>
            useTransaction(async (tx) =>
                tx
                    .select({
                        game: gameTable,
                        genres: gameGenreTable
                    })
                    .from(steamLibraryTable)
                    .innerJoin(
                        gameTable,
                        eq(steamLibraryTable.gameID, gameTable.appID)
                    )
                    .innerJoin(
                        gameGenreRelationTable,
                        eq(gameGenreRelationTable.gameID, gameTable.appID)
                    )
                    .innerJoin(
                        gameGenreTable,
                        eq(gameGenreRelationTable.genreID, gameGenreTable.id)
                    )
                    .where(
                        and(
                            eq(steamLibraryTable.steamID, input.steamID),
                            isNull(steamLibraryTable.timeDeleted)
                        )
                    )
                    .then((rows => Game.serialize(rows)))
            )
    )
}