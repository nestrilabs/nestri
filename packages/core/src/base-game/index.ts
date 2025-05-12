import { z } from "zod";
import { fn } from "../utils";
import { Common } from "../common";
import { Examples } from "../examples";
import { eq, isNull, or, and } from "drizzle-orm";
import { createTransaction, useTransaction } from "../drizzle/transaction";
import { CompatibilityEnum, baseGamesTable, Size, ControllerEnum } from "./base-game.sql";

export namespace BaseGame {
    export const Info = z.object({
        id: z.string().openapi({
            description: Common.IdDescription,
            example: Examples.BaseGame.id
        }),
        slug: z.string().openapi({
            description: "A URL-friendly unique identifier for the game, used in web addresses and API endpoints",
            example: Examples.BaseGame.slug
        }),
        name: z.string().openapi({
            description: "The official title of the game as listed on Steam",
            example: Examples.BaseGame.name
        }),
        size: Size.openapi({
            description: "Storage requirements in bytes: downloadSize represents the compressed download, and sizeOnDisk represents the installed size",
            example: Examples.BaseGame.size
        }),
        releaseDate: z.date().openapi({
            description: "The initial public release date of the game on Steam",
            example: Examples.BaseGame.releaseDate
        }),
        description: z.string().openapi({
            description: "A comprehensive overview of the game, including its features, storyline, and gameplay elements",
            example: Examples.BaseGame.description
        }),
        score: z.number().openapi({
            description: "The aggregate user review score on Steam, represented as a percentage of positive reviews",
            example: Examples.BaseGame.score
        }),
        primaryGenre: z.string().nullable().openapi({
            description: "The main category or genre that best represents the game's content and gameplay style",
            example: Examples.BaseGame.primaryGenre
        }),
        controllerSupport: z.enum(ControllerEnum.enumValues).openapi({
            description: "Indicates the level of gamepad/controller compatibility: 'Full', 'Partial', or 'Unkown' for no support",
            example: Examples.BaseGame.controllerSupport
        }),
        compatibility: z.enum(CompatibilityEnum.enumValues).openapi({
            description: "Steam Deck/Proton compatibility rating indicating how well the game runs on Linux systems",
            example: Examples.BaseGame.compatibility
        })
    }).openapi({
        ref: "BaseGame",
        description: "Detailed information about a game available in the Nestri library, including technical specifications and metadata",
        example: Examples.BaseGame
    })

    export type Info = z.infer<typeof Info>;

    export const create = fn(
        Info,
        (input) =>
            createTransaction(async (tx) => {
                await tx
                    .insert(baseGamesTable)
                    .values(input)
                    .onConflictDoUpdate({
                        target: [baseGamesTable.id, baseGamesTable.slug],
                        set: {
                            timeDeleted: null
                        }
                    })

                return input.id
            })
    )

    export const fromID = fn(
        Info.shape.id,
        (id) =>
            useTransaction(async (tx) =>
                tx
                    .select()
                    .from(baseGamesTable)
                    .where(
                        and(
                            eq(baseGamesTable.id, id),
                            isNull(baseGamesTable.timeDeleted)
                        )
                    )
                    .limit(1)
                    .then(rows => rows.map(serialize).at(0))
            )
    )

    export function serialize(
        input: typeof baseGamesTable.$inferSelect,
    ): z.infer<typeof Info> {
        return {
            id: input.id,
            name: input.name,
            slug: input.slug,
            size: input.size,
            score: input.score,
            description: input.description,
            releaseDate: input.releaseDate,
            primaryGenre: input.primaryGenre,
            compatibility: input.compatibility,
            controllerSupport: input.controllerSupport,
        };
    }
}