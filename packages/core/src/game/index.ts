import { z } from "zod";
import { fn } from "../utils";
import { Examples } from "../examples";
import { BaseGame } from "../base-game";
import { gamesTable } from "./game.sql";
import { Categories } from "../categories";
import { eq, and, isNull } from "drizzle-orm";
import { createSelectSchema } from "drizzle-zod";
import { groupBy, map, pipe, values } from "remeda";
import { baseGamesTable } from "../base-game/base-game.sql";
import { categoriesTable } from "../categories/categories.sql";
import { createTransaction, useTransaction } from "../drizzle/transaction";

export namespace Game {
    export const Info = z
        .intersection(BaseGame.Info, Categories.Info)
        .openapi({
            ref: "Game",
            description: "Detailed information about a game available in the Nestri library, including technical specifications, categories and metadata",
            example: Examples.Game
        })

    export type Info = z.infer<typeof Info>

    export const InputInfo = createSelectSchema(gamesTable)
        .omit({ timeCreated: true, timeDeleted: true, timeUpdated: true })

    export const create = fn(
        InputInfo,
        (input) =>
            createTransaction(async (tx) =>
                tx
                    .insert(gamesTable)
                    .values(input)
            )
    )

    export const fromID = fn(
        InputInfo.shape.baseGameID,
        (gameID) =>
            useTransaction(async (tx) =>
                tx
                    .select({
                        games: baseGamesTable,
                        categories: categoriesTable
                    })
                    .from(gamesTable)
                    .innerJoin(baseGamesTable,
                        eq(baseGamesTable.id, gamesTable.baseGameID)
                    )
                    .leftJoin(categoriesTable,
                        eq(categoriesTable.slug, gamesTable.categorySlug)
                    )
                    .where(
                        and(
                            eq(gamesTable.baseGameID, gameID),
                            isNull(gamesTable.timeDeleted)
                        )
                    )
                    .execute()
                    .then((rows) => serialize(rows))
            )
    )

    export function serialize(
        input: { games: typeof baseGamesTable.$inferSelect; categories: typeof categoriesTable.$inferSelect | null }[],
    ): z.infer<typeof Info>[] {
        return pipe(
            input,
            groupBy((row) => row.games.id),
            values(),
            map((group) => {
                const game = BaseGame.serialize(group[0].games)
                const cats = group.map(r => r.categories).filter((c): c is typeof categoriesTable.$inferSelect => Boolean(c))
                const byType = Categories.serialize(cats)
                return {
                    ...game,
                    ...byType
                }
            })
        )
    }

}