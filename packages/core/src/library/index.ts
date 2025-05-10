import { z } from "zod";
import { fn } from "../utils";
import { Game } from "../game";
import { Actor } from "../actor";
import { gamesTable } from "../game/game.sql";
import { createSelectSchema } from "drizzle-zod";
import { steamLibraryTable } from "./library.sql";
import { imagesTable } from "../images/images.sql";
import { and, eq, isNull, sql } from "drizzle-orm";
import { baseGamesTable } from "../base-game/base-game.sql";
import { categoriesTable } from "../categories/categories.sql";
import { createTransaction, useTransaction } from "../drizzle/transaction";

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
                                eq(steamLibraryTable.baseGameID, input.baseGameID),
                                eq(steamLibraryTable.ownerID, input.ownerID),
                                isNull(steamLibraryTable.timeDeleted)
                            )
                        )
                        .execute()

                if (results.length > 0) return null

                await tx
                    .insert(steamLibraryTable)
                    .values(input)
                    .onConflictDoUpdate({
                        target: [steamLibraryTable.ownerID, steamLibraryTable.baseGameID],
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
                            eq(steamLibraryTable.baseGameID, input.baseGameID),
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
                    images: imagesTable
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
                    eq(baseGamesTable.id, steamLibraryTable.baseGameID),
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
                .leftJoin(
                    imagesTable,
                    and(
                        eq(imagesTable.baseGameID, gamesTable.baseGameID),
                        isNull(imagesTable.timeDeleted),
                    )
                )
                .execute()
                .then(rows => Game.serialize(rows))
        )

}