import { createSelectSchema } from "drizzle-zod";
import { categoriesTable, gameCategoriesTable } from "./category.sql";

export namespace Category {
    export const CategoriesInfo = createSelectSchema(categoriesTable)
        .omit({ timeCreated: true, timeDeleted: true, timeUpdated: true })

    export const GameCategoriesInfo = createSelectSchema(gameCategoriesTable)
        .omit({ timeCreated: true, timeDeleted: true, timeUpdated: true })
}