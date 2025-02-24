import { id, timestamps } from "../drizzle/types";
import { integer, pgTable, text, uniqueIndex, varchar } from "drizzle-orm/pg-core";

export const user = pgTable(
    "user",
    {
        ...id,
        ...timestamps,
        avatarUrl: text("avatar_url"),
        email: varchar("email", { length: 255 }).notNull(),
        name: varchar("name", { length: 255 }).notNull(),
        discriminator: integer("discriminator").notNull(),
        polarCustomerID: varchar("polar_customer_id", { length: 255 }).unique().notNull(),
    },
    (user) => [
        uniqueIndex("user_email").on(user.email),
    ],
);