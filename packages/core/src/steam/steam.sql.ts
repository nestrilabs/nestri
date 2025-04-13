import { z } from "zod";
import { timestamps, userID, utc } from "../drizzle/types";
import { index, pgTable, integer, uniqueIndex, varchar, text, primaryKey, json } from "drizzle-orm/pg-core";


// public string Username { get; set; } = string.Empty;
// public ulong SteamId { get; set; }
// public string Email { get; set; } = string.Empty;
// public string Country { get; set; } = string.Empty;
// public string PersonaName { get; set; } = string.Empty;
// public string AvatarUrl { get; set; } = string.Empty;
// public bool IsLimited { get; set; }
// public bool IsLocked { get; set; }
// public bool IsBanned { get; set; }
// public bool IsAllowedToInviteFriends { get; set; }
// public ulong GameId { get; set; }
// public string GamePlayingName { get; set; } = string.Empty;
// public DateTime LastLogOn { get; set; }
// public DateTime LastLogOff { get; set; }
// public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

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
        ...userID,
        ...timestamps,
        lastSeen: utc("time_seen"),
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
        primaryKey({
            columns: [table.userID, table.id],
        }),
        uniqueIndex("steam_email").on(table.userID, table.steamEmail),
    ],
);