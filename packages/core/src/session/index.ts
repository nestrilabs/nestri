import { z } from "zod"
import { fn } from "../utils";
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

    export const create = fn(z.object({ public: z.boolean() }), async (input) => {
        try {
            const id = createID()
            const db = databaseClient()
            const user = useCurrentUser()
            const now = new Date().toISOString()

            await db.transact(
                db.tx.sessions[id]!.update({
                    public: input.public,
                    startedAt: now,
                }).link({ owner: user.id })
            )

            return id
        } catch (err) {
            return null
        }
    })

    export const getActive = async () => {
        try {
            const db = databaseClient()

            const query = {
                sessions: {
                    $: {
                        where: {
                            endedAt: { $isNull: true }
                        }
                    }
                }
            }

            const res = await db.query(query)

            const sessions = res.sessions
            if (!sessions || sessions.length === 0) {
                throw new Error("No active sessions found")
            }

            const result = pipe(
                sessions,
                groupBy(x => x.id),
                values(),
                map((group): Info => ({
                    id: group[0].id,
                    endedAt: group[0].endedAt,
                    startedAt: group[0].startedAt,
                    public: group[0].public,
                }))
            )

            return result

        } catch (error) {
            return null
        }
    }

    export const fromID = fn(z.string(), async (id) => {
        try {
            const db = databaseClient()

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

            if (!sessions || sessions.length === 0) {
                throw new Error("No sessions were found");
            }

            const result = pipe(
                sessions,
                groupBy(x => x.id),
                values(),
                map((group): Info => ({
                    id: group[0].id,
                    endedAt: group[0].endedAt,
                    startedAt: group[0].startedAt,
                    public: group[0].public,
                }))
            )
            return result
        } catch (err) {
            console.log("sessions error", err)
            return null
        }
    })

    export const fromTaskID = fn(z.string(), async (taskID) => {
        try {
            const db = databaseClient()

            const query = {
                sessions: {
                    $: {
                        where: {
                            task: taskID,
                            endedAt: { $isNull: true }
                        }
                    }
                }
            }

            const res = await db.query(query)
            const sessions = res.sessions

            if (!sessions || sessions.length === 0) {
                throw new Error("No sessions were found");
            }
            console.log("sessions", sessions)

            const result = pipe(
                sessions,
                groupBy(x => x.id),
                values(),
                map((group): Info => ({
                    id: group[0].id,
                    endedAt: group[0].endedAt,
                    startedAt: group[0].startedAt,
                    public: group[0].public,
                }))
            )
            return result[0]
        } catch (err) {
            console.log("sessions error", err)
            return null
        }
    })

    export const end = fn(z.string(), async (id) => {
        const user = useCurrentUser()
        try {
            const db = databaseClient()
            const now = new Date().toISOString()

            const query = {
                sessions: {
                    $: {
                        where: {
                            owner: user.id,
                            id,
                        }
                    }
                },
            }

            const res = await db.query(query)
            const sessions = res.sessions
            if (!sessions || sessions.length === 0) {
                throw new Error("No sessions were found");
            }

            await db.transact(db.tx.sessions[sessions[0]!.id]!.update({ endedAt: now }))

            return "ok"

        } catch (error) {

            return null
        }

    })

    export const fromOwnerID = fn(z.string(), async (id) => {
        try {
            const db = databaseClient()

            const query = {
                sessions: {
                    $: {
                        where: {
                            owner: id,
                            endedAt: { $isNull: true }
                        }
                    }
                }
            }

            const res = await db.query(query)
            const sessions = res.sessions

            if (!sessions || sessions.length === 0) {
                throw new Error("No sessions were found");
            }

            const result = pipe(
                sessions,
                groupBy(x => x.id),
                values(),
                map((group): Info => ({
                    id: group[0].id,
                    endedAt: group[0].endedAt,
                    startedAt: group[0].startedAt,
                    public: group[0].public,
                }))
            )
            return result[0]
        } catch (err) {
            console.log("session owner error", err)
            return null
        }
    })
}