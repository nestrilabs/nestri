import { z } from "zod";
import { Common } from "../common";
import { createID, fn } from "../utils";
import { Examples } from "../examples";
import { machineTable } from "./machine.sql";
import { getTableColumns, eq, sql, and, isNull } from "../drizzle";
import { createTransaction, useTransaction } from "../drizzle/transaction";

export module Machine {
    export const Info = z
        .object({
            id: z.string().openapi({
                description: Common.IdDescription,
                example: Examples.Machine.id,
            }),
            country: z.string().openapi({
                description: "The fullname of the country this machine is running in",
                example: Examples.Machine.country
            }),
            fingerprint: z.string().openapi({
                description: "The fingerprint of this machine, deduced from the host machine's machine id - /etc/machine-id",
                example: Examples.Machine.fingerprint
            }),
            location: z.object({ longitude: z.number(), latitude: z.number() }).openapi({
                description: "This is the 2d location of this machine, they might not be accurate",
                example: Examples.Machine.location
            }),
            countryCode: z.string().openapi({
                description: "This is the 2 character country code of the country this machine [ISO 3166-1 alpha-2] ",
                example: Examples.Machine.countryCode
            }),
            timezone: z.string().openapi({
                description: "The IANA timezone formatted string of the timezone of the location where the machine is running",
                example: Examples.Machine.timezone
            })
        })
        .openapi({
            ref: "Machine",
            description: "Represents a hosted or BYOG machine connected to Nestri",
            example: Examples.Machine,
        });

    export type Info = z.infer<typeof Info>;

    export const create = fn(Info.partial({ id: true }), async (input) => 
        createTransaction(async (tx) => {
            const id = input.id ?? createID("machine");
            await tx.insert(machineTable).values({
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
    )

    export const list = fn(z.void(), async () =>
        useTransaction(async (tx) => 
            tx
                .select()
                .from(machineTable)
                .where(isNull(machineTable.timeDeleted))
                .then((rows) => rows.map(serialize))
        )
    )

    export const fromID = fn(Info.shape.id, async (id) =>
        useTransaction(async (tx) =>
            tx
                .select()
                .from(machineTable)
                .where(and(eq(machineTable.id, id), isNull(machineTable.timeDeleted)))
                .then((rows) => rows.map(serialize).at(0))
        )
    )

    export const fromFingerprint = fn(Info.shape.fingerprint, async (fingerprint) =>
        useTransaction(async (tx) =>
            tx
                .select()
                .from(machineTable)
                .where(and(eq(machineTable.fingerprint, fingerprint), isNull(machineTable.timeDeleted)))
                .execute()
                .then((rows) => rows.map(serialize).at(0))
        )
    )

    export const remove = fn(Info.shape.id, (id) =>
        useTransaction(async (tx) => {
            await tx
                .update(machineTable)
                .set({
                    timeDeleted: sql`now()`,
                })
                .where(and(eq(machineTable.id, id)))
                .execute();
            return id;
        }),
    );

    export const fromLocation = fn(Info.shape.location, async (location) =>
        useTransaction(async (tx) => {
            const sqlDistance = sql`location <-> point(${location.longitude}, ${location.latitude})`;
            return tx
                .select({
                    ...getTableColumns(machineTable),
                    distance: sql`round((${sqlDistance})::numeric, 2)`
                })
                .from(machineTable)
                .where(isNull(machineTable.timeDeleted)) //Should have a status update
                .orderBy(sqlDistance)
                .limit(3)
                .then((rows) => rows.map(serialize))
        })
    )

    export function serialize(
        input: typeof machineTable.$inferSelect,
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