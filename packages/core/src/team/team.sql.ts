import { timestamps, id, ulid } from "../drizzle/types";
import {
  varchar,
  pgTable,
  primaryKey,
  bigint,
} from "drizzle-orm/pg-core";
import { userTable } from "../user/user.sql";
import { machineTable } from "../machine/machine.sql";

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
    maxMembers: bigint("max_members", { mode: "number" }).notNull(),
    machineID: ulid("machine_id")
      .notNull()
      .references(() => machineTable.id, {
        onDelete: "cascade"
      }),
  }
);

export function teamIndexes(table: any) {
  return [
    primaryKey({
      columns: [table.teamID, table.id],
    }),
  ];
}