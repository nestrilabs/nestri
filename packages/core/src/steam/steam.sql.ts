import { z } from "zod";
import { userTable } from "../user/user.sql";
import { timestamps, ulid, utc } from "../drizzle/types";
import { pgTable, varchar, text, bigint, pgEnum, json, unique } from "drizzle-orm/pg-core";

export const AccountStatusEnum = pgEnum("steam_account_status", ["new", "pending", "active"])
export const StatusEnum = pgEnum("steam_status", ["online", "offline", "dnd", "playing"])

export const Limitations = z.object({
    isLimited: z.boolean(),
    isTradeBanned: z.boolean(),
    isVacBanned: z.boolean(),
    visibilityState: z.number(),
    privacyState: z.enum(["public", "private"]),
})

export type Limitations = z.infer<typeof Limitations>;

export const steamTable = pgTable(
    "steam_accounts",
    {
        ...timestamps,
        id: bigint("steam_id", { mode: "bigint" })
            .primaryKey()
            .notNull(),
        userID: ulid("user_id")
            .references(() => userTable.id, {
                onDelete: "cascade",
            }),
        status: StatusEnum("status").notNull(),
        memberSince: utc("member_since").notNull(),
        lastSyncedAt: utc("last_synced_at").notNull(),
        name: varchar("name", { length: 255 }).notNull(),
        profileUrl: varchar("profileUrl", { length: 255 }),
        username: varchar("username", { length: 255 }).notNull(),
        realName: varchar("real_name", { length: 255 }).notNull(),
        accountStatus: AccountStatusEnum("account_status").notNull(),
        avatarHash: varchar("avatar_hash", { length: 255 }).notNull(),
        limitations: json("limitations").$type<Limitations>().notNull(),
    },
    (table)=>[
        unique("idx_steam_username").on(table.username)
    ]
);

export const steamCredentialsTable = pgTable(
    "steam_account_credentials",
    {
        ...timestamps,
        refreshToken: text("refresh_token")
            .notNull(),
        id: bigint("steam_id", { mode: "bigint" })
            .notNull()
            .primaryKey()
            .references(() => steamTable.id, {
                onDelete: "cascade"
            }),
        username: varchar("username", { length: 255 }).notNull(),
    }
)