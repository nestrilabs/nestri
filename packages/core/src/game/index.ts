import { z } from "zod";
import { fn } from "../utils";
import { Common } from "../common";
import { Examples } from "../examples";
import { createTransaction } from "../drizzle/transaction";
import { CompatibilityEnum, gamesTable, Size } from "./game.sql";

export namespace Game {
    export const Info = z.object({
        id: z.string().openapi({
            description: Common.IdDescription,
            example: Examples.Game.id
        }),
        slug: z.string().openapi({
            description: "A URL-friendly unique identifier for the game, used in web addresses and API endpoints",
            example: Examples.Game.slug
        }),
        name: z.string().openapi({
            description: "The official title of the game as listed on Steam",
            example: Examples.Game.name
        }),
        size: Size.openapi({
            description: "Total required storage space in gigabytes, including both download size and installed size",
            example: Examples.Game.size
        }),
        releaseDate: z.date().openapi({
            description: "The initial public release date of the game on Steam",
            example: Examples.Game.releaseDate
        }),
        description: z.string().openapi({
            description: "A comprehensive overview of the game, including its features, storyline, and gameplay elements",
            example: Examples.Game.description
        }),
        score: z.number().openapi({
            description: "The aggregate user review score on Steam, represented as a percentage of positive reviews",
            example: Examples.Game.score
        }),
        primaryGenre: z.string().openapi({
            description: "The main category or genre that best represents the game's content and gameplay style",
            example: Examples.Game.primaryGenre
        }),
        controllerSupport: z.string().nullable().openapi({
            description: "Indicates the level of gamepad/controller compatibility: 'Full', 'Partial', or null for no support",
            example: Examples.Game.controllerSupport
        }),
        compatibility: z.enum(CompatibilityEnum.enumValues).openapi({
            description: "Steam Deck/Proton compatibility rating indicating how well the game runs on Linux systems",
            example: Examples.Game.compatibility
        })
    }).openapi({
        ref: "Game",
        description: "Detailed information about a game available in the Nestri library, including technical specifications and metadata",
        example: Examples.Game
    })

    export type Info = z.infer<typeof Info>;

    export const create = fn(
        Info,
        (input) =>
            createTransaction(async (tx) => {
                await tx
                    .insert(gamesTable)
                    .values({
                        ...input
                    })
                return input.id
            })
    )

    export function serialize(
        input: typeof gamesTable.$inferSelect,
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