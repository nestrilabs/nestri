import { z } from "zod";
import databaseClient from "../database"
import { fn } from "../utils";
import { groupBy, map, pipe, values } from "remeda"
import { Common } from "../common";
import { Examples } from "../examples";
import { useCurrentUser } from "../actor";
import { id as createID } from "@instantdb/admin";

export namespace Teams {
    export const Info = z
        .object({
            id: z.string().openapi({
                description: Common.IdDescription,
                example: Examples.Team.id,
            }),
            name: z.string().openapi({
                description: "Name of the team",
                example: Examples.User.email,
            }),
            createdAt: z.string().or(z.number()).openapi({
                description: "The time when this team was first created",
                example: Examples.Team.createdAt,
            }),
            updatedAt: z.string().or(z.number()).openapi({
                description: "The time when this team was last edited",
                example: Examples.Team.updatedAt,
            }),
            owner: z.boolean().openapi({
                description: "Whether this team is owned by this user",
                example: Examples.Team.owner,
            }),
            slug: z.string().openapi({
                description: "This is the unique name identifier for the team",
                example: Examples.Team.slug
            })
        })
        .openapi({
            ref: "Team",
            description: "A group of users sharing the same machines for gaming.",
            example: Examples.Team,
        });

    export type Info = z.infer<typeof Info>;

    export const list = async () => {
        const db = databaseClient()
        const user = useCurrentUser()

        const query = {
            teams: {
                $: {
                    where: {
                        members: user.id,
                        deletedAt: { $isNull: true }
                    }
                },
            }
        }

        const res = await db.query(query)

        const teams = res.teams
        if (!teams || teams.length === 0) {
            return null
        }

        const result = pipe(
            teams,
            groupBy(x => x.id),
            values(),
            map((group): Info => ({
                id: group[0].id,
                name: group[0].name,
                createdAt: group[0].createdAt,
                updatedAt: group[0].updatedAt,
                slug: group[0].slug,
                //@ts-expect-error
                owner: group[0].owner === user.id
            }))
        )

        return result
    }


    export const fromSlug = fn(z.string(), async (slug) => {
        const db = databaseClient()

        const query = {
            teams: {
                $: {
                    where: {
                        slug,
                        deletedAt: { $isNull: true }
                    }
                },
            }
        }

        const res = await db.query(query)

        const teams = res.teams
        if (!teams || teams.length === 0) {
            return null
        }

        const result = pipe(
            teams,
            groupBy(x => x.id),
            values(),
            map((group): Info => ({
                id: group[0].id,
                name: group[0].name,
                createdAt: group[0].createdAt,
                slug: group[0].slug,
                updatedAt: group[0].updatedAt,
                //@ts-expect-error
                owner: group[0].owner === user.id
            }))
        )

        return result[0]
    })

    export const create = fn(Info.pick({ name: true, slug: true }), async (input) => {
        const id = createID()
        const db = databaseClient()
        const user = useCurrentUser()
        const now = new Date().toISOString()

        await db.transact(db.tx.teams[id]!.update({
            name: input.name,
            slug: input.slug,
            createdAt: now,
            updatedAt: now,
        }).link({ owner: user.id, members: user.id }))

        return id
    })

    export const remove = fn(z.string(), async (id) => {
        const db = databaseClient()
        const now = new Date().toISOString()

        await db.transact(db.tx.teams[id]!.update({
           deletedAt: now
        }))

        return "ok"
    })

    export const invite = fn(z.object({email:z.string(), id: z.string()}), async (input) => {
        //TODO:
        // const db = databaseClient()
        // const now = new Date().toISOString()

        // await db.transact(db.tx.teams[id]!.update({
        //    deletedAt: now
        // }))

        return "ok"
    })

}