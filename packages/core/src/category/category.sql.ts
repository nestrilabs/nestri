import { timestamps} from "../drizzle/types";
import { gamesTable } from "../game/game.sql";
import { pgEnum, pgTable, primaryKey, text, varchar } from "drizzle-orm/pg-core";

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

export const gameCategoriesTable = pgTable(
    'game_categories',
    {
        ...timestamps,
        gameId: varchar('game_id', { length: 255 })
            .notNull()
            .references(() => gamesTable.id,
                { onDelete: "cascade" }
            ),
        categorySlug: varchar('category_slug', { length: 255 })
            .notNull()
            .references(() => categoriesTable.slug,
                { onDelete: "cascade" }
            ),
    },
    (table) => [
        primaryKey({
            columns: [table.gameId, table.categorySlug]
        }),
    ]
);