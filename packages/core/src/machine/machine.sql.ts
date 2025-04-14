import { } from "drizzle-orm/postgres-js";
import { timestamps, id, ulid } from "../drizzle/types";
import {
    text,
    varchar,
    pgTable,
    uniqueIndex,
    point,
    primaryKey,
} from "drizzle-orm/pg-core";

export const machineTable = pgTable(
    "machine",
    {
        ...id,
        ...timestamps,
        // userID: ulid("user_id"),
        country: text('country').notNull(),
        timezone: text('timezone').notNull(),
        location: point('location', { mode: 'xy' }).notNull(),
        fingerprint: varchar('fingerprint', { length: 32 }).notNull(),
        countryCode: varchar('country_code', { length: 2 }).notNull(),
        // provider: text("provider").notNull(),
        // gpuType: text("gpu_type").notNull(),
        // storage: numeric("storage").notNull(),
        // ipaddress: text("ipaddress").notNull(),
        // gpuNumber: integer("gpu_number").notNull(),
        // computePrice: numeric("compute_price").notNull(),
        // driverVersion: integer("driver_version").notNull(),
        // operatingSystem: text("operating_system").notNull(),
        // fingerprint: varchar("fingerprint", { length: 32 }).notNull(),
        // externalID: varchar("external_id", { length: 255 }).notNull(),
        // cudaVersion: numeric("cuda_version", { precision: 4, scale: 2 }).notNull(),
    },
    (table) => [
        // uniqueIndex("external_id").on(table.externalID),
        uniqueIndex("machine_fingerprint").on(table.fingerprint),
        // primaryKey({ columns: [table.userID, table.id], }),
    ],
);