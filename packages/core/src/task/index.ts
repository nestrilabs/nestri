import { z } from "zod";
import { Common } from "../common";
import { Examples } from "../examples";
import { createID, fn } from "../utils";
import { taskTable } from "./task.sql";
import { getTableColumns, eq, sql, and, isNull } from "../drizzle";
import { createTransaction, useTransaction } from "../drizzle/transaction";

export module Task {
    export const Info = z
        .object({
            id: z.string().openapi({
                description: Common.IdDescription,
                example: Examples.Task.id,
            }),
            country: z.string().openapi({
                description: "The fullname of the country this task is running in",
                example: Examples.Task.country
            }),
            fingerprint: z.string().openapi({
                description: "The fingerprint of this task, deduced from the host machine's machine id - /etc/machine-id",
                example: Examples.Task.fingerprint
            }),
            location: z.object({ longitude: z.number(), latitude: z.number() }).openapi({
                description: "This is the 2d location of this machine, they might not be accurate",
                example: Examples.Task.location
            }),
            countryCode: z.string().openapi({
                description: "This is the 2 character country code of the country this task is running [ISO 3166-1 alpha-2] ",
                example: Examples.Task.countryCode
            }),
            timezone: z.string().openapi({
                description: "The IANA timezone formatted string of the timezone of the location where the task is running",
                example: Examples.Task.timezone
            })
        })
        .openapi({
            ref: "Task",
            description: "Represents a task running on a Nestri hosted or BYOG machine",
            example: Examples.Task,
        });

    export type Info = z.infer<typeof Info>;

    export const create = fn(Info.partial({ id: true }), async (input) => {
        //TODO: Add support for BYOG, as we know this guys do not give us SSH access to their machine
        createTransaction(async (tx) => {
            const id = input.id ?? createID("task");
            await tx.insert(taskTable).values({
                id,
                country: input.country,
                timezone: input.timezone,
                fingerprint: input.fingerprint,
                countryCode: input.countryCode,
                location: { x: input.location.longitude, y: input.location.latitude },
            })

            // await afterTx(() =>
            //     bus.publish(Resource.Bus, Events.Created, {
            //         teamID: id,
            //     }),
            // );
            return id;
        })
    })

    export const list = fn(z.void(), async () => {
        useTransaction((tx) =>
            tx
                .select()
                .from(taskTable)
                .where(isNull(taskTable.timeDeleted))
                .execute()
                .then((rows) => rows.map(serialize)),
        )
    })

    export const fromID = fn(Info.shape.id, async (id) => {
        useTransaction(async (tx) => {
            return tx
                .select()
                .from(taskTable)
                .where(and(eq(taskTable.id, id),isNull(taskTable.timeDeleted)))
                .execute()
                .then((rows) => rows.map(serialize))
                .then((rows) => rows.at(0));
        })
    })

    export const fromLocation = fn(Info.shape.location, async (location) => {
        useTransaction(async (tx) => {
            const sqlDistance = sql`location <-> point(${location.longitude}, ${location.latitude})`;
            return tx
                .select({
                    ...getTableColumns(taskTable),
                    distance: sql`round((${sqlDistance})::numeric, 2)`
                })
                .from(taskTable)
                .where(isNull(taskTable.timeDeleted))
                .orderBy(sqlDistance)
                .limit(3)
                .execute()
                .then((rows) => rows.map(serialize))
                .then((rows) => rows.at(0));
        })
    })

    export function serialize(
        input: typeof taskTable.$inferSelect,
    ): z.infer<typeof Info> {
        return {
            id: input.id,
            country: input.country,
            timezone: input.timezone,
            fingerprint: input.fingerprint,
            countryCode: input.countryCode,
            location: { latitude: input.location.y, longitude: input.location.x },
        };
    }
}