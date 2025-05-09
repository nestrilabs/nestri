import { timestamps} from "../drizzle/types";
import { baseGamesTable } from "../base-game/base-game.sql";
import { categoriesTable } from "../category/category.sql";
import { pgTable, primaryKey, varchar } from "drizzle-orm/pg-core";

export const gamesTable = pgTable(
    'games',
    {
        ...timestamps,
        gameID: varchar('game_id', { length: 255 })
            .notNull()
            .references(() => baseGamesTable.id,
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
            columns: [table.gameID, table.categorySlug]
        }),
    ]
);