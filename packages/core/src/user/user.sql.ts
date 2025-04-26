import { id, timestamps } from "../drizzle/types";
import { pgTable, unique, uniqueIndex, varchar } from "drizzle-orm/pg-core";

export const userTable = pgTable(
    "users",
    {
        ...id,
        ...timestamps,
        email: varchar("email", { length: 255 }).notNull(),
        username: varchar("username", { length: 255 }).notNull(),
        polarCustomerID: varchar("polar_customer_id", { length: 255 }),
    },
    (user) => [
        uniqueIndex("idx_user_email").on(user.email),
        unique("idx_username").on(user.username),
    ]
);