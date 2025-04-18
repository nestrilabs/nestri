import { z } from "zod";
import { userTable } from "../user/user.sql";
import { id, timestamps, ulid, utc } from "../drizzle/types";
import { index, pgTable, integer, uniqueIndex, varchar, text, json } from "drizzle-orm/pg-core";

export const LastGame = z.object({
    gameID: z.number(),
    gameName: z.string()
});

export const AccountLimitation = z.object({
    isLimited: z.boolean().nullable(),
    isBanned: z.boolean().nullable(),
    isLocked: z.boolean().nullable(),
    isAllowedToInviteFriends: z.boolean().nullable(),
});

export type LastGame = z.infer<typeof LastGame>;
export type AccountLimitation = z.infer<typeof AccountLimitation>;

export const steamTable = pgTable(
    "steam",
    {
        ...id,
        ...timestamps,
        userID: ulid("user_id")
            .notNull()
            .references(() => userTable.id, {
                onDelete: "cascade",
            }),
        lastSeen: utc("last_seen").notNull(),
        steamID: integer("steam_id").notNull(),
        avatarUrl: text("avatar_url").notNull(),
        lastGame: json("last_game").$type<LastGame>().notNull(),
        username: varchar("username", { length: 255 }).notNull(),
        countryCode: varchar('country_code', { length: 2 }).notNull(),
        steamEmail: varchar("steam_email", { length: 255 }).notNull(),
        personaName: varchar("persona_name", { length: 255 }).notNull(),
        limitation: json("limitation").$type<AccountLimitation>().notNull(),
    },
    (table) => [
        uniqueIndex("steam_id").on(table.steamID),
        index("steam_user_id").on(table.userID),
    ],
);