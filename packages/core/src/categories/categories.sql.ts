import { timestamps } from "../drizzle/types";
import { index, pgEnum, pgTable, primaryKey, text, varchar } from "drizzle-orm/pg-core";

// Intentional grammatical error on category
export const CategoryTypeEnum = pgEnum("category_type", ["tag", "genre", "publisher", "developer", "categorie", "franchise"])

export const categoriesTable = pgTable(
    "categories",
    {
        ...timestamps,
        slug: varchar("slug", { length: 255 })
            .notNull(),
        type: CategoryTypeEnum("type").notNull(),
        name: text("name").notNull(),
    },
    (table) => [
        primaryKey({
            columns: [table.slug, table.type]
        }),
        index("idx_categories_type").on(table.type),
    ]
)