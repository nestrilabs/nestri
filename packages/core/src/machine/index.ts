import databaseClient from "../database"
import { z } from "zod"
import { Common } from "../common";
import { createID, fn } from "../utils";
import { Examples } from "../examples";

export module Machine {
    export const Info = z
        .object({
            id: z.string().openapi({
                description: Common.IdDescription,
                example: Examples.Machine.id,
            }),
            name: z.string().openapi({
                description: "Name of the machine",
                example: Examples.Machine.name,
            }),
            fingerprint: z.string().nullable().openapi({
                description: "The machine's fingerprint, derived from their public SSH key.",
                example: Examples.Machine.fingerprint,
            })
        })
        .openapi({
            ref: "Machine",
            description: "A machine running Nestri.",
            example: Examples.Machine,
        });

    export const create = fn(z.object({
        fingerprint: z.string(),
        name: z.string(),
        owner: z.string(),
        location: z.string()
    }), async (input) => {
        const id = createID("machine")
        const now = new Date().getTime()
        const db = databaseClient()

        await db.transact(db.tx.machines[id]!.update({
            fingerprint: input.fingerprint,
            name: input.name,
            createdAt: now,
            location: input.location
        }).link({
            owner: input.owner
        }))

        return id
    })

    export const linkTeam = fn(z.object({ id: z.string(), teamId: z.string() }), async (input) => {
        const db = databaseClient()
        const res = await db.transact(db.tx.machines[input.id]!.link({
            team: input.teamId
        }))

        return res
    })

    export const fromFingerprint = fn(z.string(), async (fingerprint) => {
        const query = {
            "machines": {
                $: {
                    where: {
                        fingerprint,
                    },
                },
            },
        };

        const db = databaseClient()

        const res = await db.query(query)
        return res.machines
    })
}