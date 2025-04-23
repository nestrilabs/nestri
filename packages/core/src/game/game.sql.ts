import { z } from "zod";
import { timestamps, utc, } from "../drizzle/types";
import { pgTable, varchar, text, unique, bigint, primaryKey, boolean, date, json } from "drizzle-orm/pg-core";

export const Achievements = z
    .object({
        total: z.number(),
        highlighted: z
            .object({
                name: z.string(),
                path: z.string().url()
            })
            .array()
    })

export const Pegi = z
    .object({
        rating: z.string(),
        description: z.string(),
        requiredAge: z.number()
    })

export const SystemRequirements = z
    .object({
        minimum: z.string(),
        recommended: z.string()
    })

export const Company = z
    .object({
        name: z.string(),
        url: z.string().url().nullable()
    })
    .array()

export type Pegi = z.infer<typeof Pegi>;
export type Company = z.infer<typeof Company>;
export type Achievements = z.infer<typeof Achievements>;
export type SystemRequirements = z.infer<typeof SystemRequirements>;

export const gameTable = pgTable(
    "steam_game",
    {
        ...timestamps,
        name: text("name").notNull(),
        isFree: boolean("is_free").notNull(),
        website: text("website_url").notNull(),
        legalNotice: text("legal_notice").notNull(),
        description: text("description").notNull(),
        releaseDate: utc("release_date").notNull(),
        nativeLinux: boolean("native_linux").notNull(),
        appID: bigint("app_id", { mode: "number" }).notNull(),
        achievements: json("achievements").$type<Achievements>().notNull(),
        isSinglePlayer: boolean("is_single_player").notNull(),
        supportsSteamCloud: boolean("supports_steamcloud").notNull(),
        supportsFamilySharing: boolean("supports_familysharing").notNull(),
        reviews: text("reviews").notNull(),
        pegi: json("pegi").$type<Pegi>().notNull(),
        protonCompatibility: bigint("proton_compatibility", { mode: "number" }).notNull(),
        controllerSupport: varchar("controller_support", { length: 255 }).notNull(),
        systemRequirements: json("system_requirement").$type<SystemRequirements>().notNull(),
        publishers: json("publishers").$type<Company>().notNull(),
        developers: json("developers").$type<Company>().notNull(),
    },
    (table) => [
        unique("idx_game_appid").on(table.appID),
        primaryKey({
            columns: [table.appID]
        })
    ],
);

export const gameGenreTable = pgTable(
    "steam_game_genre",
    {
        ...timestamps,
        id: varchar("id", { length: 255 }).notNull(),
        name: varchar("name", { length: 255 }).notNull(),
    },
    (table) => [
        unique("idx_game_genre").on(table.name),
        primaryKey({
            columns: [table.id]
        })
    ],
);

export const gameGenreRelationTable = pgTable(
    "steam_game_genre_relation",
    {
        ...timestamps,
        gameID: bigint("game_id", { mode: "number" })
            .notNull()
            .references(() => gameTable.appID, {
                onDelete: "cascade"
            }),
        genreID: varchar("genre_id", { length: 255 })
            .notNull()
            .references(() => gameGenreTable.id, {
                onDelete: "cascade"
            }),
    },
    (table) => [
        primaryKey({
            columns: [table.gameID, table.genreID]
        })
    ],
);