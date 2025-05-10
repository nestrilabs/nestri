import { z } from "zod";
import { fn } from "../utils";
import { Game } from "../game";
import { gamesTable } from "../game/game.sql";
import { createSelectSchema } from "drizzle-zod";
import { steamLibraryTable } from "./library.sql";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { baseGamesTable } from "../base-game/base-game.sql";
import { categoriesTable } from "../categories/categories.sql";
import { createTransaction, useTransaction } from "../drizzle/transaction";
import { Actor } from "../actor";

export namespace Library {
    export const Info = createSelectSchema(steamLibraryTable)
        .omit({ timeCreated: true, timeDeleted: true, timeUpdated: true })

    export type Info = z.infer<typeof Info>;

    export const add = fn(
        Info,
        async (input) =>
            createTransaction(async (tx) =>
                tx
                    .insert(steamLibraryTable)
                    .values({
                        ownerID: input.ownerID,
                        gameID: input.gameID
                    })
                    .onConflictDoUpdate({
                        target: [steamLibraryTable.ownerID, steamLibraryTable.gameID],
                        set: { timeDeleted: null }
                    })

            )
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
                            eq(steamLibraryTable.ownerID, input.ownerID),
                            eq(steamLibraryTable.gameID, input.gameID),
                        )
                    )
            )
    )

    export const list = () =>
        useTransaction(async (tx) =>
            tx
                .select({
                    games: baseGamesTable,
                    categories: categoriesTable
                })
                .from(steamLibraryTable)
                .where(
                    and(
                        eq(steamLibraryTable.ownerID, Actor.steamID()),
                        isNull(steamLibraryTable.timeDeleted)
                    )
                )
                .innerJoin(
                    baseGamesTable,
                    eq(baseGamesTable.id, steamLibraryTable.gameID),
                )
                .leftJoin(
                    gamesTable,
                    eq(gamesTable.baseGameID, baseGamesTable.id),
                )
                .leftJoin(
                    categoriesTable,
                    eq(categoriesTable.slug, gamesTable.categorySlug),
                )
                .execute()
                .then(rows => Game.serialize(rows))
        )

    export const fromSteamID = fn(
        Info.shape.ownerID,
        (steamID) =>
            useTransaction(async (tx) =>
                tx
                    .select({
                        games: baseGamesTable,
                        categories: categoriesTable
                    })
                    .from(steamLibraryTable)
                    .where(
                        and(
                            eq(steamLibraryTable.ownerID, steamID),
                            isNull(steamLibraryTable.timeDeleted)
                        )
                    )
                    .innerJoin(
                        baseGamesTable,
                        eq(baseGamesTable.id, steamLibraryTable.gameID),
                    )
                    .innerJoin(
                        gamesTable,
                        eq(gamesTable.baseGameID, baseGamesTable.id),
                    )
                    .innerJoin(
                        categoriesTable,
                        eq(categoriesTable.slug, gamesTable.categorySlug),
                    )
                    .execute()
                    .then(rows => Game.serialize(rows))
            )
    )

    export const fromSteamIDs = fn(
        Info.shape.ownerID.array(),
        (steamIDs) =>
            useTransaction(async (tx) =>
                tx
                    .select({
                        games: baseGamesTable,
                        categories: categoriesTable
                    })
                    .from(steamLibraryTable)
                    .where(
                        and(
                            inArray(steamLibraryTable.ownerID, steamIDs),
                            isNull(steamLibraryTable.timeDeleted)
                        )
                    )
                    .innerJoin(
                        baseGamesTable,
                        eq(baseGamesTable.id, steamLibraryTable.gameID),
                    )
                    .innerJoin(
                        gamesTable,
                        eq(gamesTable.baseGameID, baseGamesTable.id),
                    )
                    .innerJoin(
                        categoriesTable,
                        eq(categoriesTable.slug, gamesTable.categorySlug),
                    )
                    .execute()
                    .then(rows => Game.serialize(rows))
            )
    )

}