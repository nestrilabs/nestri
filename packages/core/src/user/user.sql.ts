import { z } from "zod";
import { id, timestamps } from "../drizzle/types";
import { integer, pgTable, text, uniqueIndex, varchar } from "drizzle-orm/pg-core";

export const userTable = pgTable(
    "user",
    {
        ...id,
        ...timestamps,
        avatarUrl: text("avatar_url"),
        name: varchar("name", { length: 255 }).notNull(),
        discriminator: integer("discriminator").notNull(),
        email: varchar("email", { length: 255 }).notNull(),
        polarCustomerID: varchar("polar_customer_id", { length: 255 }).unique(),
    },
    (user) => [
        uniqueIndex("user_email").on(user.email),
    ]
);