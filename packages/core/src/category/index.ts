import { createSelectSchema } from "drizzle-zod";
import { categoriesTable } from "./category.sql";

export namespace Category {
    export const Info = createSelectSchema(categoriesTable)
        .omit({ timeCreated: true, timeDeleted: true, timeUpdated: true })
}