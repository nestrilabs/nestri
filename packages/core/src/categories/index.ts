import { z } from "zod";
import { fn } from "../utils";
import { Examples } from "../examples";
import { createSelectSchema } from "drizzle-zod";
import { categoriesTable } from "./categories.sql";
import { createTransaction } from "../drizzle/transaction";
import { eq, isNull, and } from "drizzle-orm";

export namespace Categories {

    const Category = z.object({
        slug: z.string().openapi({
            description: "A URL-friendly unique identifier for the category",
            example: "action-adventure"
        }),
        name: z.string().openapi({
            description: "The human-readable display name of the category",
            example: "Action Adventure"
        })
    })

    export const Info =
        z.object({
            publishers: Category.array().openapi({
                description: "List of companies or organizations responsible for publishing and distributing the game",
                example: Examples.Categories.publishers
            }),
            developers: Category.array().openapi({
                description: "List of studios, teams, or individuals who created and developed the game",
                example: Examples.Categories.developers
            }),
            tags: Category.array().openapi({
                description: "User-defined labels that describe specific features, themes, or characteristics of the game",
                example: Examples.Categories.tags
            }),
            genres: Category.array().openapi({
                description: "Primary classification categories that define the game's style and type of gameplay",
                example: Examples.Categories.genres
            })
        }).openapi({
            ref: "Categories",
            description: "A comprehensive categorization system for games, including publishing details, development credits, and content classification",
            example: Examples.Categories
        })

    export type Info = z.infer<typeof Info>;

    export const InputInfo = createSelectSchema(categoriesTable)
        .omit({ timeCreated: true, timeDeleted: true, timeUpdated: true })

    export const create = fn(
        InputInfo,
        (input) =>
            createTransaction(async (tx) => {
                const results =
                    await tx
                        .select()
                        .from(categoriesTable)
                        .where(
                            and(
                                eq(categoriesTable.slug, input.slug),
                                eq(categoriesTable.type, input.type),
                                isNull(categoriesTable.timeDeleted)
                            )
                        )
                        .execute()

                if (results.length > 0) return null

                await tx
                    .insert(categoriesTable)
                    .values(input)
                    .onConflictDoUpdate({
                        target: [categoriesTable.slug, categoriesTable.type],
                        set: { timeDeleted: null }
                    })

                return input.slug
            })
    )

    export function serialize(
        input: typeof categoriesTable.$inferSelect[],
    ): z.infer<typeof Info> {
        return input.reduce<Record<`${typeof categoriesTable.$inferSelect["type"]}s`, { slug: string; name: string }[]>>((acc, cat) => {
            const key = `${cat.type}s` as `${typeof cat.type}s`
            acc[key]!.push({ slug: cat.slug, name: cat.name })
            return acc
        }, {
            tags: [],
            genres: [],
            publishers: [],
            developers: []
        })
    }
}