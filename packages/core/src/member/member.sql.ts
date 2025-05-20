import { isNotNull } from "drizzle-orm";
import { userTable } from "../user/user.sql";
import { steamTable } from "../steam/steam.sql";
import { timestamps, teamID, ulid } from "../drizzle/types";
import { bigint, pgEnum, pgTable, primaryKey, uniqueIndex, varchar } from "drizzle-orm/pg-core";

export const RoleEnum = pgEnum("member_role", ["child", "adult"])

export const memberTable = pgTable(
    "members",
    {
        ...teamID,
        ...timestamps,
        userID: ulid("user_id")
            .references(() => userTable.id, {
                onDelete: "cascade"
            }),
        steamID: varchar("steam_id", { length: 255 })
            .notNull()
            .references(() => steamTable.steamID, {
                onDelete: "cascade",
                onUpdate: "restrict"
            }),
        role: RoleEnum("role").notNull(),
    },
    (table) => [
        primaryKey({ columns: [table.id, table.teamID] }),
        uniqueIndex("idx_member_steam_id").on(table.teamID, table.steamID),
        uniqueIndex("idx_member_user_id")
            .on(table.teamID, table.userID)
            .where(isNotNull(table.userID))
    ],
);