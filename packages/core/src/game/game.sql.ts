import { timestamps } from "../drizzle/types";
import { baseGamesTable } from "../base-game/base-game.sql";
import { categoriesTable } from "../categories/categories.sql";
import { index, pgTable, primaryKey, varchar } from "drizzle-orm/pg-core";

export const gamesTable = pgTable(
    'games',
    {
        ...timestamps,
        baseGameID: varchar('base_game_id', { length: 255 })
            .notNull()
            .references(() => baseGamesTable.id,
                { onDelete: "cascade" }
            ),
        categorySlug: varchar('category_slug', { length: 255 })
            .notNull()
            .references(() => categoriesTable.slug,
                { onDelete: "cascade" }
            ),
        categoryType: varchar('category_type', { length: 255 })
            .notNull()
            .references(() => categoriesTable.type,
                { onDelete: "cascade" }
            ),
    },
    (table) => [
        primaryKey({
            columns: [table.baseGameID, table.categorySlug, table.categoryType]
        }),
        index("idx_games_category_slug").on(table.categorySlug),
        index("idx_games_category_type").on(table.categoryType),
    ]
);