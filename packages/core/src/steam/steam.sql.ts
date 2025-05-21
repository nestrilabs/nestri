import { z } from "zod";
import { userTable } from "../user/user.sql";
import { id, timestamps, ulid, utc } from "../drizzle/types";
import { pgTable, varchar, pgEnum, json, unique } from "drizzle-orm/pg-core";

export const StatusEnum = pgEnum("steam_status", ["online", "offline", "dnd", "playing"])

export const Limitations = z.object({
    isLimited: z.boolean(),
    tradeBanState: z.enum(["none", "probation", "banned"]),
    isVacBanned: z.boolean(),
    visibilityState: z.number(),
    privacyState: z.enum(["public", "private", "friendsfriendsonly", "friendsonly"]),
})

export type Limitations = z.infer<typeof Limitations>;

export const steamTable = pgTable(
    "steam_accounts",
    {
        ...timestamps,
        id: varchar("id", { length: 255 })
            .primaryKey()
            .notNull(),
        userID: ulid("user_id")
            .references(() => userTable.id, {
                onDelete: "cascade",
            }),
        status: StatusEnum("status").notNull(),
        lastSyncedAt: utc("last_synced_at").notNull(),
        realName: varchar("real_name", { length: 255 }),
        steamMemberSince: utc("member_since").notNull(),
        name: varchar("name", { length: 255 }).notNull(),
        profileUrl: varchar("profile_url", { length: 255 }),
        avatarHash: varchar("avatar_hash", { length: 255 }).notNull(),
        limitations: json("limitations").$type<Limitations>().notNull(),
    }
);