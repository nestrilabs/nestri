import { timestamps} from "../drizzle/types";
import { pgEnum, pgTable, text, varchar } from "drizzle-orm/pg-core";

export const TypeEnum = pgEnum("category_type", ["tag", "genre", "publisher", "developer"])

export const categoriesTable = pgTable(
    "categories",
    {
        ...timestamps,
        slug: varchar("slug", { length: 255 })
            .notNull()
            .primaryKey(),
        type: TypeEnum("type").notNull(),
        name: text("name").notNull(),
    }
)