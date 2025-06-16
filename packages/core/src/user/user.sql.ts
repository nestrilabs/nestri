import { id, timestamps, utc } from "../drizzle/types";
import { pgTable, text, unique, varchar } from "drizzle-orm/pg-core";

export const userTable = pgTable(
    "users",
    {
        ...id,
        ...timestamps,
        email: varchar("email", { length: 255 }).notNull(),
        avatarUrl: text("avatar_url"),
        lastLogin: utc("last_login").notNull(),
        name: varchar("name", { length: 255 }).notNull(),
        polarCustomerID: varchar("polar_customer_id", { length: 255 }),
    },
    (user) => [
        unique("idx_user_email").on(user.email),
    ]
);