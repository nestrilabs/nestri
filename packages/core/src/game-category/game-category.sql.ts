import { timestamps} from "../drizzle/types";
import { gamesTable } from "../game/game.sql";
import { categoriesTable } from "../category/category.sql";
import { pgTable, primaryKey, varchar } from "drizzle-orm/pg-core";

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