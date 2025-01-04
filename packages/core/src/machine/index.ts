import { z } from "zod"
import { fn } from "../utils";
import { Common } from "../common";
import { Examples } from "../examples";
import { useCurrentUser } from "../actor";
import databaseClient from "../database"
import { id as createID } from "@instantdb/admin";

export module Machine {
    export const Info = z
        .object({
            id: z.string().openapi({
                description: Common.IdDescription,
                example: Examples.Machine.id,
            }),
            hostname: z.string().openapi({
                description: "The Linux hostname that identifies this machine",
                example: Examples.Machine.hostname,
            }),
            fingerprint: z.string().openapi({
                description: "A unique identifier derived from the machine's Linux machine ID.",
                example: Examples.Machine.fingerprint,
            }),
            createdAt: z.string().openapi({
                description: "Represents a machine running on the Nestri network, containing its identifying information and metadata.",
                example: Examples.Machine.createdAt,
            })
        })
        .openapi({
            ref: "Machine",
            description: "Represents a a physical or virtual machine connected to the Nestri network..",
            example: Examples.Machine,
        });

    export const create = fn(Info.pick({ fingerprint: true, hostname: true }), async (input) => {
        const id = createID()
        const now = new Date().toISOString()
        const db = databaseClient()
        await db.transact(
            db.tx.machines[id]!.update({
                fingerprint: input.fingerprint,
                hostname: input.hostname,
                createdAt: now,
            })
        )

        return id
    })

    export const remove = fn(z.string(), async (id) => {
        const now = new Date().toISOString()
        const user = useCurrentUser()
        const db = databaseClient().asUser({ token: user.token })
        await db.transact(db.tx.machines[id]!.update({ deletedAt: now }))

        return "ok"
    })

    export const fromID = fn(z.string(), async (id) => {
        const user = useCurrentUser()
        const db = databaseClient().asUser({ token: user.token })

        const query = {
            machines: {
                $: {
                    where: {
                        id: id,
                        deletedAt: { $isNull: true }
                    }
                }
            }
        }

        const res = await db.query(query)

        return res.machines[0]
    })

    export const fromFingerprint = fn(z.string(), async (input) => {
        const db = databaseClient()

        const query = {
            machines: {
                $: {
                    where: {
                        fingerprint: input,
                        deletedAt: { $isNull: true }
                    }
                }
            }
        }

        const res = await db.query(query)

        return res.machines[0]
    })

    export const list = async () => {
        const user = useCurrentUser()
        const db = databaseClient().asUser({ token: user.token })

        const query = {
            $users: {
                $: { where: { id: user.id } },
                machines: {
                    $: {
                        deletedAt: { $isNull: true }
                    }
                }
            },
        }

        const res = await db.query(query)

        return res.$users[0]?.machines
    }

    export const link = fn(z.object({
        machineId: z.string()
    }), async (input) => {
        const user = useCurrentUser()
        const db = databaseClient()

        await db.transact(db.tx.machines[input.machineId]!.link({ owner: user.id }))

        return "ok"
    })
}