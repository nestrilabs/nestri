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
            createTransaction(async (tx) => {
                const results =
                    await tx
                        .select()
                        .from(steamLibraryTable)
                        .where(
                            and(
                                eq(steamLibraryTable.gameID, input.gameID),
                                eq(steamLibraryTable.ownerID, input.ownerID),
                                isNull(steamLibraryTable.timeDeleted)
                            )
                        )
                        .execute()

                if (results.length > 0) return null

                await tx
                    .insert(steamLibraryTable)
                    .values({
                        ownerID: input.ownerID,
                        gameID: input.gameID
                    })
                    .onConflictDoUpdate({
                        target: [steamLibraryTable.ownerID, steamLibraryTable.gameID],
                        set: { timeDeleted: null }
                    })

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
                    categories: categoriesTable,
                    categoriesType: categoriesTable.type,
                    categoriesSlug: categoriesTable.slug,
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
                    and(
                        eq(categoriesTable.slug, gamesTable.categorySlug),
                        eq(categoriesTable.type, gamesTable.categoryType),
                    )
                )
                .groupBy(
                    gamesTable.baseGameID,
                    categoriesTable.type,
                    categoriesTable.slug,
                )
                .execute()
                .then(rows => Game.serialize(rows))
        )

}