import { createSelectSchema } from "drizzle-zod";
import { gameCategoriesTable } from "./game-category.sql";

export namespace GameCategory{
    export const Info = createSelectSchema(gameCategoriesTable)
        .omit({ timeCreated: true, timeDeleted: true, timeUpdated: true })
}