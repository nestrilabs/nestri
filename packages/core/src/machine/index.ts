import databaseClient from "../database"
import { z } from "zod"
import { Common } from "../common";
import { fn } from "../utils";
import { Examples } from "../examples";
import { useCurrentUser } from "../actor";
import { id as createID } from "@instantdb/admin";

export module Machine {
    export const Info = z
        .object({
            id: z.string().openapi({
                description: Common.IdDescription,
                example: Examples.Machine.id,
            }),
            hostname: z.string().openapi({
                description: "Hostname of the machine",
                example: Examples.Machine.hostname,
            }),
            fingerprint: z.string().openapi({
                description: "The machine's fingerprint, derived from the machine's Linux machine ID.",
                example: Examples.Machine.fingerprint,
            }),
            location: z.string().openapi({
                description: "The machine's approximate location; country and continent.",
                example: Examples.Machine.location,
            })
        })
        .openapi({
            ref: "Machine",
            description: "A machine running on the Nestri network.",
            example: Examples.Machine,
        });

    export const create = fn(z.object({
        fingerprint: z.string(),
        hostname: z.string(),
        location: z.string()
    }), async (input) => {
        const id = createID()
        const now = new Date().getTime()
        const db = databaseClient()//.asUser({ email: "elviswanjohi47@gmail.com" })
        await db.transact(
            db.tx.machines[id]!.update({
                fingerprint: input.fingerprint,
                hostname: input.hostname,
                location: input.location,
                createdAt: now,
            })
        )

        return id
    })

    export const remove = fn(z.string(), async (id) => {
        const now = new Date().getTime()
        // const device = useCurrentDevice()
        // const db = databaseClient()

        // if (device.id) { // the machine can delete itself
        //     await db.transact(db.tx.machines[device.id]!.update({ deletedAt: now }))
        // } else {// the user can delete it manually
        const user = useCurrentUser()
        const db = databaseClient().asUser({ token: user.token })
        await db.transact(db.tx.machines[id]!.update({ deletedAt: now }))
        // }

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