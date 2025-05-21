import { timestamps, id } from "../drizzle/types";
import {
  varchar,
  pgTable,
  bigint,
  unique,
} from "drizzle-orm/pg-core";
import { steamTable } from "../steam/steam.sql";

export const teamTable = pgTable(
  "teams",
  {
    ...id,
    ...timestamps,
    name: varchar("name", { length: 255 }).notNull(),
    inviteCode: varchar("invite_code", { length: 10 }).notNull(),
    ownerSteamID: varchar("owner_steam_id", { length: 255 })
      .notNull()
      .references(() => steamTable.id, {
        onDelete: "cascade"
      }),
    maxMembers: bigint("max_members", { mode: "number" }).notNull(),
  },
  (team) => [
    unique("idx_team_invite_code").on(team.inviteCode)
  ]
);