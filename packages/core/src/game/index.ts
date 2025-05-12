import { z } from "zod";
import { fn } from "../utils";
import { Images } from "../images";
import { Examples } from "../examples";
import { BaseGame } from "../base-game";
import { gamesTable } from "./game.sql";
import { Categories } from "../categories";
import { eq, and, isNull } from "drizzle-orm";
import { createSelectSchema } from "drizzle-zod";
import { imagesTable } from "../images/images.sql";
import { baseGamesTable } from "../base-game/base-game.sql";
import { groupBy, map, pipe, uniqueBy, values } from "remeda";
import { categoriesTable } from "../categories/categories.sql";
import { createTransaction, useTransaction } from "../drizzle/transaction";

export namespace Game {
    export const Info = z
        .intersection(BaseGame.Info, Categories.Info, Images.Info)
        .openapi({
            ref: "Game",
            description: "Detailed information about a game available in the Nestri library, including technical specifications, categories and metadata",
            example: Examples.Game
        })

    export type Info = z.infer<typeof Info>;

    export const InputInfo = createSelectSchema(gamesTable)
        .omit({ timeCreated: true, timeDeleted: true, timeUpdated: true })

    export const create = fn(
        InputInfo,
        (input) =>
            createTransaction(async (tx) => {
                const result =
                    await tx
                        .select()
                        .from(gamesTable)
                        .where(
                            and(
                                eq(gamesTable.categorySlug, input.categorySlug),
                                eq(gamesTable.categoryType, input.categoryType),
                                eq(gamesTable.baseGameID, input.baseGameID),
                                isNull(gamesTable.timeDeleted)
                            )
                        )
                        .limit(1)
                        .execute()
                        .then(rows => rows.at(0))

                if (result) return result.baseGameID

                await tx
                    .insert(gamesTable)
                    .values(input)
                    .onConflictDoUpdate({
                        target: [gamesTable.categorySlug, gamesTable.categoryType, gamesTable.baseGameID],
                        set: { timeDeleted: null }
                    })

                return input.baseGameID
            })
    )

    export const fromID = fn(
        InputInfo.shape.baseGameID,
        (gameID) =>
            useTransaction(async (tx) =>
                tx
                    .select({
                        games: baseGamesTable,
                        categories: categoriesTable,
                        images: imagesTable
                    })
                    .from(gamesTable)
                    .innerJoin(baseGamesTable,
                        eq(baseGamesTable.id, gamesTable.baseGameID)
                    )
                    .leftJoin(categoriesTable,
                        and(
                            eq(categoriesTable.slug, gamesTable.categorySlug),
                            eq(categoriesTable.type, gamesTable.categoryType),
                        )
                    )
                    .leftJoin(imagesTable,
                        and(
                            eq(imagesTable.baseGameID, gamesTable.baseGameID),
                            isNull(imagesTable.timeDeleted),
                        )
                    )
                    .where(
                        and(
                            eq(gamesTable.baseGameID, gameID),
                            isNull(gamesTable.timeDeleted)
                        )
                    )
                    .execute()
                    .then((rows) => serialize(rows).at(0))
            )
    )

    export function serialize(
        input: { games: typeof baseGamesTable.$inferSelect; categories: typeof categoriesTable.$inferSelect | null; images: typeof imagesTable.$inferSelect | null }[],
    ): z.infer<typeof Info>[] {
        return pipe(
            input,
            groupBy((row) => row.games.id),
            values(),
            map((group) => {
                const game = BaseGame.serialize(group[0].games)
                const cats = uniqueBy(
                    group.map(r => r.categories).filter((c): c is typeof categoriesTable.$inferSelect => Boolean(c)),
                    (c) => `${c.slug}:${c.type}`
                )
                const imgs = uniqueBy(
                    group.map(r => r.images).filter((c): c is typeof imagesTable.$inferSelect => Boolean(c)),
                    (c) => `${c.type}:${c.imageHash}:${c.position}`
                )
                const byType = Categories.serialize(cats)
                const byImg = Images.serialize(imgs)
                return {
                    ...game,
                    ...byType,
                    ...byImg
                }
            })
        )
    }

}