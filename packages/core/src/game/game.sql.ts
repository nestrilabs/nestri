import { timestamps } from "../drizzle/types";
import { baseGamesTable } from "../base-game/base-game.sql";
import { categoriesTable, CategoryTypeEnum } from "../categories/categories.sql";
import { foreignKey, index, pgTable, primaryKey, varchar } from "drizzle-orm/pg-core";

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
            .notNull(),
        categoryType: CategoryTypeEnum("type").notNull()
    },
    (table) => [
        primaryKey({
            columns: [table.baseGameID, table.categorySlug, table.categoryType]
        }),
        foreignKey({
            name: "games_categories_fkey",
            columns: [table.categorySlug, table.categoryType],
            foreignColumns: [categoriesTable.slug, categoriesTable.type],
        }).onDelete("cascade"),
        index("idx_games_category_slug").on(table.categorySlug),
        index("idx_games_category_type").on(table.categoryType),
        index("idx_games_category_slug_type").on(
            table.categorySlug,
            table.categoryType
        )
    ]
);