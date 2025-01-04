import { z } from "zod"
import { fn } from "../utils";
import { Games } from "../game";
import { Machines } from "../machine";
import { Common } from "../common";
import { Examples } from "../examples";
import databaseClient from "../database"
import { useCurrentUser } from "../actor";
import { groupBy, map, pipe, values } from "remeda"
import { id as createID } from "@instantdb/admin";

export module Sessions {
    export const Info = z
        .object({
            id: z.string().openapi({
                description: Common.IdDescription,
                example: Examples.Session.id,
            }),
            name: z.string().openapi({
                description: "A human-readable name for the session to help identify it",
                example: Examples.Session.name,
            }),
            public: z.boolean().openapi({
                description: "If true, the session is publicly viewable by all users. If false, only authorized users can access it",
                example: Examples.Session.public,
            }),
            endedAt: z.string().or(z.number()).or(z.undefined()).openapi({
                description: "The timestamp indicating when this session was completed or terminated. Null if session is still active.",
                example: Examples.Session.endedAt,
            }),
            startedAt: z.string().or(z.number()).openapi({
                description: "The timestamp indicating when this session started.",
                example: Examples.Session.startedAt,
            })
        })
        .openapi({
            ref: "Session",
            description: "Represents a single game play session, tracking its lifetime and accessibility settings.",
            example: Examples.Session,
        });

    export type Info = z.infer<typeof Info>;

    export const create = fn(z.object({ name: z.string(), public: z.boolean(), fingerprint: z.string(), steamID: z.number() }), async (input) => {
        const id = createID()
        const now = new Date().toISOString()
        const db = databaseClient()
        const user = useCurrentUser()
        const machine = await Machines.fromFingerprint(input.fingerprint)
        if (!machine) {
            return { error: "Such a machine does not exist" }
        }

        const games = await Machines.installedGames(machine.id)

        if (!games) {
            return { error: "The machine has no installed games" }
        }

        const result = pipe(
            games,
            groupBy(x => x.steamID === input.steamID ? "similar" : undefined),
        )

        if (!result.similar || result.similar.length == 0) {

            return { error: "The machine does not have this game installed" }
        }

        await db.transact(
            db.tx.sessions[id]!.update({
                name: input.name,
                public: input.public,
                startedAt: now,
            }).link({ owner: user.id, machine: machine.id, game: result.similar[0].id })
        )

        return { data: id }
    })

    export const list = async () => {
        const user = useCurrentUser()
        const db = databaseClient()

        const query = {
            $users: {
                $: { where: { id: user.id } },
                sessions: {}
            },
        }

        const res = await db.query(query)

        const sessions = res.$users[0]?.sessions
        if (sessions && sessions.length > 0) {
            const result = pipe(
                sessions,
                groupBy(x => x.id),
                values(),
                map((group): Info => ({
                    id: group[0].id,
                    endedAt: group[0].endedAt,
                    startedAt: group[0].startedAt,
                    public: group[0].public,
                    name: group[0].name
                }))
            )
            return result
        }
        return null
    }

    export const getActive = async () => {
        const user = useCurrentUser()
        const db = databaseClient()

        const query = {
            $users: {
                $: { where: { id: user.id } },
                sessions: {
                    $: {
                        where: {
                            endedAt: { $isNull: true }
                        }
                    }
                }
            },
        }

        const res = await db.query(query)

        const sessions = res.$users[0]?.sessions
        if (sessions && sessions.length > 0) {
            const result = pipe(
                sessions,
                groupBy(x => x.id),
                values(),
                map((group): Info => ({
                    id: group[0].id,
                    endedAt: group[0].endedAt,
                    startedAt: group[0].startedAt,
                    public: group[0].public,
                    name: group[0].name
                }))
            )
            return result
        }
        return null
    }

    export const getPublicActive = async () => {
        const db = databaseClient()

        const query = {
            sessions: {
                $: {
                    where: {
                        endedAt: { $isNull: true },
                        public: true
                    }
                }
            }
        }

        const res = await db.query(query)

        const sessions = res.sessions
        if (sessions && sessions.length > 0) {
            const result = pipe(
                sessions,
                groupBy(x => x.id),
                values(),
                map((group): Info => ({
                    id: group[0].id,
                    endedAt: group[0].endedAt,
                    startedAt: group[0].startedAt,
                    public: group[0].public,
                    name: group[0].name
                }))
            )
            return result
        }
        return null
    }

    export const fromID = fn(z.string(), async (id) => {
        const db = databaseClient()
        useCurrentUser()

        const query = {
            sessions: {
                $: {
                    where: {
                        id: id,
                    }
                }
            }
        }

        const res = await db.query(query)
        const sessions = res.sessions

        if (sessions && sessions.length > 0) {
            const result = pipe(
                sessions,
                groupBy(x => x.id),
                values(),
                map((group): Info => ({
                    id: group[0].id,
                    endedAt: group[0].endedAt,
                    startedAt: group[0].startedAt,
                    public: group[0].public,
                    name: group[0].name
                }))
            )
            return result
        }

        return null
    })

    export const end = fn(z.string(), async (id) => {
        const user = useCurrentUser()
        const db = databaseClient()
        const now = new Date().toISOString()

        const query = {
            $users: {
                $: { where: { id: user.id } },
                sessions: {
                    $: {
                        where: {
                            id,
                        }
                    }
                }
            },
        }

        const res = await db.query(query)
        const sessions = res.$users[0]?.sessions
        if (sessions && sessions.length > 0) {
            const session = sessions[0] as Info
            await db.transact(db.tx.sessions[session.id]!.update({ endedAt: now }))

            return "ok"
        }

        return null
    })
}