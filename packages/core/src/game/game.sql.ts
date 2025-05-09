import { z } from "zod";
import { timestamps, utc } from "../drizzle/types";
import { json, numeric, pgEnum, pgTable, primaryKey, text, unique, varchar } from "drizzle-orm/pg-core";

export const CompatibilityEnum = pgEnum("compatibility", ["high", "mid", "low"])

export const Size =
    z.object({
        downloadSize: z.number(),
        sizeOnDisk: z.number()
    })

export type Size = z.infer<typeof Size>

export const gamesTable = pgTable(
    "games",
    {
        id: varchar("id", { length: 255 })
            .primaryKey()
            .notNull(),
        slug: varchar("slug", { length: 255 })
            .notNull(),
        name: text("name").notNull(),
        releaseDate: utc("release_date").notNull(),
        size: json("size").$type<Size>().notNull(),
        description: text("description").notNull(),
        primaryGenre: text("primary_genre").notNull(),
        controllerSupport: text("controller_support"),
        compatibility: CompatibilityEnum("compatibility").notNull(),
        score: numeric("score", { precision: 2, scale: 1 }).$type<number>().notNull()
    },
    (table) => [
        unique("idx_game_slug").on(table.slug),
    ]
)