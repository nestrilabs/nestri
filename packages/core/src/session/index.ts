import { z } from "zod"
import { fn } from "../utils";
import { Common } from "../common";
import { Examples } from "../examples";
import { useCurrentUser } from "../actor";
import databaseClient from "../database"
import { id as createID } from "@instantdb/admin";

export module Session {
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
            endedAt: z.string().openapi({
                description: "The timestamp indicating when this session was completed or terminated. Null if session is still active.",
                example: Examples.Session.endedAt,
            }),
            createdAt: z.string().openapi({
                description: "The timestamp indicating when this session started.",
                example: Examples.Session.createdAt,
            })
        })
        .openapi({
            ref: "Session",
            description: "Represents a single game play session, tracking its lifetime and accessibility settings.",
            example: Examples.Session,
        });

    export const create = fn(Info.pick({ name: true, public: true }), async (input) => {
        const id = createID()
        const now = new Date().toISOString()
        const db = databaseClient()
        const user = useCurrentUser()
        await db.transact(
            db.tx.sessions[id]!.update({
                name: input.name,
                public: input.public,
                createdAt: now,
            }).link({ owner: user.id })
        )

        return id
    })
}