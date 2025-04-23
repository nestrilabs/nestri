import { z } from "zod";
import { id, timestamps } from "../drizzle/types";
import { integer, pgTable, text, uniqueIndex, varchar, json } from "drizzle-orm/pg-core";

// Whether this user is part of the Nestri Team, comes with privileges
export const UserFlags = z.object({
    team: z.boolean().optional(),
});

export type UserFlags = z.infer<typeof UserFlags>;

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