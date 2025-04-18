import { teamTable } from "../team/team.sql";
import { ulid, userID, timestamps } from "../drizzle/types";
import { index, integer, pgTable, primaryKey, text, uniqueIndex, varchar } from "drizzle-orm/pg-core";

export const Standing = ["new", "good", "overdue", "cancelled"] as const;
export const PlanType = ["free", "pro", "family", "enterprise"] as const;

export const subscriptionTable = pgTable(
    "subscription",
    {
        ...userID,
        ...timestamps,
        teamID: ulid("team_id")
            .references(() => teamTable.id, { onDelete: "cascade" })
            .notNull(),
        standing: text("standing", { enum: Standing })
            .notNull(),
        planType: text("plan_type", { enum: PlanType })
            .notNull(),
        tokens: integer("tokens").notNull(),
        polarProductID: varchar("product_id", { length: 255 }),
        polarSubscriptionID: varchar("subscription_id", { length: 255 }),
    },
    (table) => [
        uniqueIndex("subscription_id").on(table.id),
        index("subscription_user_id").on(table.userID),
        primaryKey({
            columns: [table.id, table.teamID]
        }),
    ]
)