import databaseClient from "../database"
import { z } from "zod"
import { Common } from "../common";
import { createID, fn } from "../utils";
import { Examples } from "../examples";

export module Team {
    export const Info = z
        .object({
            id: z.string().openapi({
                description: Common.IdDescription,
                example: Examples.Team.id,
            }),
            name: z.string().openapi({
                description: "Name of the machine",
                example: Examples.Team.name,
            }),
            type: z.string().nullable().openapi({
                description: "Whether this is a personal or family type of team",
                example: Examples.Team.type,
            })
        })
        .openapi({
            ref: "Team",
            description: "A group of Nestri user's who share the same machine",
            example: Examples.Team,
        });

    export const create = fn(z.object({
        name: z.string(),
        type: z.enum(["personal", "family"]),
        owner: z.string(),
    }), async (input) => {
        const id = createID("machine")
        const now = new Date().getTime()
        const db = databaseClient()
        
        await db.transact(db.tx.teams[id]!.update({
            name: input.name,
            type: input.type,
            createdAt: now
        }).link({
            owner: input.owner,
        }))

        return id
    })
}