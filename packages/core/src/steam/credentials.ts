import { z } from "zod";
import { Resource } from "sst";
import { bus } from "sst/aws/bus";
import { createEvent } from "../event";
import { eq, and, isNull } from "../drizzle";
import { decrypt, encrypt, fn } from "../utils";
import { createSelectSchema } from "drizzle-zod";
import { steamCredentialsTable } from "./steam.sql";
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
        NewCredentials: createEvent(
            "new_credentials.added",
            z.object({
                steamID: Info.shape.id,
            }),
        ),
    };

    export const create = fn(
        Info
            .omit({ accessToken: true, cookies: true }),
        (input) =>
            createTransaction(async (tx) => {
                const encryptedToken = encrypt(input.refreshToken)
                await tx
                    .insert(steamCredentialsTable)
                    .values({
                        id: input.id,
                        username: input.username,
                        refreshToken: encryptedToken,
                    })
                await afterTx(async () =>
                    await bus.publish(Resource.Bus, Events.NewCredentials, { steamID: input.id })
                );
                return input.id
            }),
    );

    export const getByID = fn(
        Info.shape.id,
        (steamID) =>
            useTransaction(async (tx) => {
                const credential = await tx
                    .select()
                    .from(steamCredentialsTable)
                    .where(
                        and(
                            eq(steamCredentialsTable.id, steamID),
                            isNull(steamCredentialsTable.timeDeleted)
                        )
                    )
                    .execute()
                    .then(rows => rows.at(0));

                if (!credential) return null;

                return serialize({ ...credential, refreshToken: decrypt(credential.refreshToken) });
            })
    );
    
    export function serialize(
        input: typeof steamCredentialsTable.$inferSelect,
    ) {
        return {
            id: input.id,
            username: input.refreshToken,
            refreshToken: input.refreshToken,
        };
    }
}