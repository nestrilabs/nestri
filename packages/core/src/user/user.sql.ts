import { id, timestamps } from "../drizzle/types";
import { pgTable, uniqueIndex, varchar } from "drizzle-orm/pg-core";

export const userTable = pgTable(
    "users",
    {
        ...id,
        ...timestamps,
        email: varchar("email", { length: 255 }).notNull(),
        username: varchar("username", { length: 255 }).notNull(),
        polarCustomerID: varchar("polar_customer_id", { length: 255 }),
        displayName: varchar("display_name", { length: 255 }).notNull(),
    },
    (user) => [
        uniqueIndex("idx_user_polar_id").on(user.polarCustomerID),
        uniqueIndex("idx_user_email").on(user.email),
        uniqueIndex("idx_username").on(user.username),
    ]
);