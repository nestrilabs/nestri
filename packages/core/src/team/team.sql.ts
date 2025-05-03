import { timestamps, id, ulid } from "../drizzle/types";
import {
  varchar,
  pgTable,
  primaryKey,
  bigint,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { userTable } from "../user/user.sql";
import { steamTable } from "../steam/steam.sql";

export const teamTable = pgTable(
  "teams",
  {
    ...id,
    ...timestamps,
    name: varchar("name", { length: 255 }).notNull(),
    ownerID: ulid("owner_id")
      .notNull()
      .references(() => userTable.id, {
        onDelete: "cascade"
      }),
    inviteCode: varchar("invite_code", { length: 10 }).notNull(),
    slug: varchar("slug", { length: 255 })
      .notNull()
      .references(() => steamTable.username, {
        onDelete: "cascade"
      }),
    maxMembers: bigint("max_members", { mode: "number" }).notNull(),
  },
  (team) => [
    uniqueIndex("idx_team_slug").on(team.slug),
    unique("idx_team_invite_code").on(team.inviteCode)
  ]
);

export function teamIndexes(table: any) {
  return [
    primaryKey({
      columns: [table.teamID, table.id],
    }),
  ];
}