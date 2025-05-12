import { z } from "zod";
import { timestamps } from "../drizzle/types";
import { baseGamesTable } from "../base-game/base-game.sql";
import { index, integer, json, pgEnum, pgTable, primaryKey, text, varchar } from "drizzle-orm/pg-core";

export const ImageTypeEnum = pgEnum("image_type", ["heroArt", "icon", "logo", "banner", "poster", "boxArt", "screenshot", "backdrop"])

export const ImageDimensions = z.object({
    width: z.number().int(),
    height: z.number().int(),
})

export const ImageColor = z.object({
    hex: z.string(),
    isDark: z.boolean()
})

export type ImageColor = z.infer<typeof ImageColor>;
export type ImageDimensions = z.infer<typeof ImageDimensions>;

export const imagesTable = pgTable(
    "images",
    {
        ...timestamps,
        type: ImageTypeEnum("type").notNull(),
        imageHash: varchar("image_hash", { length: 255 })
            .notNull(),
        baseGameID: varchar("base_game_id", { length: 255 })
            .notNull()
            .references(() => baseGamesTable.id, {
                onDelete: "cascade"
            }),
        sourceUrl: text("source_url"), // The BoxArt is source Url will always be null;
        position: integer("position").notNull().default(0),
        fileSize: integer("file_size").notNull(),
        dimensions: json("dimensions").$type<ImageDimensions>().notNull(),
        extractedColor: json("extracted_color").$type<ImageColor>().notNull(),
    },
    (table) => [
        primaryKey({
            columns: [table.imageHash, table.type, table.baseGameID, table.position]
        }),
        index("idx_images_type").on(table.type),
        index("idx_images_game_id").on(table.baseGameID),
    ]
)