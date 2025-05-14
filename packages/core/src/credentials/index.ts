import { z } from "zod";
import { createID, fn } from "../utils";
import { Resource } from "sst";
import { bus } from "sst/aws/bus";
import { createEvent } from "../event";
import { eq, and, isNull, gt } from "drizzle-orm";
import { createSelectSchema } from "drizzle-zod";
import { steamCredentialsTable } from "./credentials.sql";
import { afterTx, createTransaction, useTransaction } from "../drizzle/transaction";

export namespace Credentials {
    export const Info = createSelectSchema(steamCredentialsTable)
        .omit({ timeCreated: true, timeDeleted: true, timeUpdated: true })
        .extend({
            accessToken: z.string(),
            cookies: z.string().array()
        })

    export type Info = z.infer<typeof Info>;

    export const Events = {
        New: createEvent(
            "new_credentials.added",
            z.object({
                steamID: Info.shape.steamID,
            }),
        ),
    };

    export const create = fn(
        Info
            .omit({ accessToken: true, cookies: true, expiry: true })
            .partial({ id: true }),
        (input) => {
            const part = input.refreshToken.split('.')[1] as string

            const payload = JSON.parse(Buffer.from(part, 'base64').toString());

            return createTransaction(async (tx) => {
                const id = input.id ?? createID("credentials")
                await tx
                    .insert(steamCredentialsTable)
                    .values({
                        id,
                        steamID: input.steamID,
                        username: input.username,
                        refreshToken: input.refreshToken,
                        expiry: new Date(payload.exp * 1000),
                    })
                await afterTx(async () =>
                    await bus.publish(Resource.Bus, Events.New, { steamID: input.steamID })
                );
                return id
            })
        });

    export const fromID = fn(
        Info.shape.steamID,
        (steamID) =>
            useTransaction(async (tx) => {
                const now = new Date()

                const credential = await tx
                    .select()
                    .from(steamCredentialsTable)
                    .where(
                        and(
                            eq(steamCredentialsTable.steamID, steamID),
                            isNull(steamCredentialsTable.timeDeleted),
                            gt(steamCredentialsTable.expiry, now)
                        )
                    )
                    .execute()
                    .then(rows => rows.at(0));

                if (!credential) return null;

                return serialize(credential);
            })
    );

    export function serialize(
        input: typeof steamCredentialsTable.$inferSelect,
    ) {
        return {
            id: input.id,
            expiry: input.expiry,
            steamID: input.steamID,
            username: input.username,
            refreshToken: input.refreshToken,
        };
    }
}