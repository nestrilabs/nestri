import { bigint, pgEnum, pgTable } from "drizzle-orm/pg-core";
import { teamID, timestamps } from "../drizzle/types";

export const CreditsType = ["gpu", "bandwidth", "storage"] as const;
export const creditsEnum = pgEnum('credits_type', CreditsType);

export const usage = pgTable(
    "usage",
    {
        ...teamID,
        ...timestamps,
        type: creditsEnum("type").notNull(),
        creditsUsed: bigint("credits_used", { mode: "number" }).notNull(),
    }
)