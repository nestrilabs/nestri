import { z } from "zod"
import { fn } from "../utils";
import { Common } from "../common";
import { Examples } from "../examples";
import databaseClient from "../database"
import { id as createID } from "@instantdb/admin";
import { groupBy, map, pipe, values } from "remeda"

export module Instances {
    export const Info = z
        .object({
            id: z.string().openapi({
                description: Common.IdDescription,
                example: Examples.Instance.id,
            }),
            hostname: z.string().openapi({
                description: "The container's hostname",
                example: Examples.Instance.hostname,
            }),
            createdAt: z.string().or(z.number()).openapi({
                description: "The time this instances was registered on the network",
                example: Examples.Instance.createdAt,
            }),
            lastActive: z.string().or(z.number()).optional().openapi({
                description: "The time this instance was last seen on the network",
                example: Examples.Instance.lastActive,
            })
        })
        .openapi({
            ref: "Instance",
            description: "Represents a running container that is connected to the Nestri network..",
            example: Examples.Instance,
        });

    export type Info = z.infer<typeof Info>;
    export const create = fn(z.object({ hostname: z.string(), teamID: z.string() }), async (input) => {
        const id = createID()
        const now = new Date().toISOString()
        const db = databaseClient()
        await db.transact(
            db.tx.instances[id]!.update({
                hostname: input.hostname,
                createdAt: now,
            }).link({ owners: input.teamID })
        )

        return "ok"
    })

    export const fromTeamID = fn(z.string(), async (teamID) => {
        const db = databaseClient()

        const query = {
            instances: {
                $: {
                    where: {
                        owners: teamID
                    }
                }
            }
        }

        const res = await db.query(query)
        const data = res.instances

        if (data && data.length > 0) {
            const result = pipe(
                data,
                groupBy(x => x.id),
                values(),
                map((group): Info => ({
                    id: group[0].id,
                    lastActive: group[0].lastActive,
                    hostname: group[0].hostname,
                    createdAt: group[0].createdAt
                }))
            )
            return result
        }

        return null
    })
}