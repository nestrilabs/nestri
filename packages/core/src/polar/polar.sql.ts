import { timestamps, teamID } from "../drizzle/types";
import { teamIndexes, teamTable } from "../team/team.sql";
import { pgTable, text, varchar } from "drizzle-orm/pg-core";

export const Standing = ["new", "good", "overdue"] as const;

export const polarTable = pgTable(
    "stripe",
    {
        teamID: teamID.teamID.primaryKey().references(() => teamTable.id),
        ...timestamps,
        customerID: varchar("customer_id", { length: 255 }).notNull(),
        subscriptionID: varchar("subscription_id", { length: 255 }),
        subscriptionItemID: varchar("subscription_item_id", {
            length: 255,
        }),
        standing: text("standing", { enum: Standing }).notNull(),
    },
    (table) => ({
        ...teamIndexes(table),
    })
)