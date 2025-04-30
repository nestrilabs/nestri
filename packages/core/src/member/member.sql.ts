import { userTable } from "../user/user.sql";
import { steamTable } from "../steam/steam.sql";
import { timestamps, teamID, ulid } from "../drizzle/types";
import { bigint, pgEnum, pgTable, primaryKey, uniqueIndex } from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("member_role", ["child", "adult"])

export const memberTable = pgTable(
    "members",
    {
        ...teamID,
        ...timestamps,
        userID: ulid("user_id")
            .references(() => userTable.id, {
                onDelete: "cascade"
            }),
        steamID: bigint("steam_id", { mode: "bigint" })
            .notNull()
            .references(() => steamTable.id, {
                onDelete: "cascade",
                onUpdate: "restrict"
            }),
        role: roleEnum("role").notNull(),
    },
    (table) => [
        primaryKey({ columns: [table.id] }),
        uniqueIndex("idx_member_steam_id").on(table.teamID, table.steamID),
    ],
);