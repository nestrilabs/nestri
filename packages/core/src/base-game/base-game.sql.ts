import { z } from "zod";
import { timestamps, utc } from "../drizzle/types";
import { json, numeric, pgEnum, pgTable, text, unique, varchar } from "drizzle-orm/pg-core";

export const CompatibilityEnum = pgEnum("compatibility", ["high", "mid", "low", "unknown"])
export const ControllerEnum = pgEnum("controller_support", ["full", "partial", "unknown"])

export const Size =
    z.object({
        downloadSize: z.number().positive().int(),
        sizeOnDisk: z.number().positive().int()
    });

export const Links = z.string().array();

export type Size = z.infer<typeof Size>;
export type Links = z.infer<typeof Links>;

export const baseGamesTable = pgTable(
    "base_games",
    {
        ...timestamps,
        id: varchar("id", { length: 255 })
            .primaryKey()
            .notNull(),
        links: json("links").$type<Links>(),
        slug: varchar("slug", { length: 255 })
            .notNull(),
        name: text("name").notNull(),
        description: text("description"),
        releaseDate: utc("release_date").notNull(),
        size: json("size").$type<Size>().notNull(),
        primaryGenre: text("primary_genre"),
        controllerSupport: ControllerEnum("controller_support").notNull(),
        compatibility: CompatibilityEnum("compatibility").notNull().default("unknown"),
        // Score ranges from 0.0 to 5.0
        score: numeric("score", { precision: 2, scale: 1 })
            .$type<number>()
            .notNull()
    },
    (table) => [
        unique("idx_base_games_slug").on(table.slug),
    ]
)