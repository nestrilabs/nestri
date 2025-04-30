import { userTable } from "../user/user.sql";
import { steamTable } from "../steam/steam.sql";
import { timestamps, teamID, ulid } from "../drizzle/types";
import { bigint, pgTable, primaryKey, text, uniqueIndex } from "drizzle-orm/pg-core";

export const role = ["child", "adult"] as const;

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
            .references(() => steamTable.id, {
                onDelete: "cascade",
                onUpdate: "cascade"
            }),
        role: text("role", { enum: role }).notNull(),
    },
    (table) => [
        primaryKey({ columns: [table.id] }),
        uniqueIndex("idx_member_steam_id").on(table.teamID, table.steamID),
    ],
);