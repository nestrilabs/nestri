import { z } from "zod"
import { fn } from "../utils";
import { Common } from "../common";
import { Examples } from "../examples";
import databaseClient from "../database"
import { id as createID } from "@instantdb/admin";
import { groupBy, map, pipe, values } from "remeda"
import { useCurrentDevice, useCurrentUser } from "../actor";

export module Games {
    export const Info = z
        .object({
            id: z.string().openapi({
                description: Common.IdDescription,
                example: Examples.Game.id,
            }),
            name: z.string().openapi({
                description: "A human-readable name for the game, used for easy identification.",
                example: Examples.Game.name,
            }),
            steamID: z.number().openapi({
                description: "The Steam ID of the game, used to identify it during installation and runtime.",
                example: Examples.Game.steamID,
            })
        })
        .openapi({
            ref: "Game",
            description: "Represents a Steam game that can be installed and played on a machine.",
            example: Examples.Game,
        });

    export type Info = z.infer<typeof Info>;

    export const create = fn(Info.pick({ name: true, steamID: true }), async (input) => {
        const id = createID()
        const db = databaseClient()
        const device = useCurrentDevice()

        await db.transact(
            db.tx.games[id]!.update({
                name: input.name,
                steamID: input.steamID,
            }).link({ machines: device.id })
        )

        return id
    })

    export const list = async () => {
        const db = databaseClient()
        const user = useCurrentUser()

        const query = {
            $users: {
                $: { where: { id: user.id } },
                games: {}
            },
        }

        const res = await db.query(query)

        const games = res.$users[0]?.games
        if (games && games.length > 0) {
            const result = pipe(
                games,
                groupBy(x => x.id),
                values(),
                map((group): Info => ({
                    id: group[0].id,
                    name: group[0].name,
                    steamID: group[0].steamID,
                }))
            )
            return result
        }
        return null
    }

    export const fromSteamID = fn(z.number(), async (steamID) => {
        const db = databaseClient()

        const query = {
            games: {
                $: {
                    where: {
                        steamID,
                    }
                }
            }
        }

        const res = await db.query(query)

        const games = res.games

        if (games.length > 0) {
            const result = pipe(
                games,
                groupBy(x => x.id),
                values(),
                map((group): Info => ({
                    id: group[0].id,
                    name: group[0].name,
                    steamID: group[0].steamID,
                }))
            )
            return result[0]
        }

        return null
    })

    export const linkToCurrentUser = fn(z.string(), async (steamID) => {
        const user = useCurrentUser()
        const db = databaseClient()

        await db.transact(db.tx.games[steamID]!.link({ owners: user.id }))

        return "ok"
    })

    export const unLinkFromCurrentUser = fn(z.number(), async (steamID) => {
        const user = useCurrentUser()
        const db = databaseClient()

        const query = {
            $users: {
                $: { where: { id: user.id } },
                games: {
                    $: {
                        where: {
                            steamID,
                        }
                    }
                }
            },
        }

        const res = await db.query(query)
        const games = res.$users[0]?.games
        if (games && games.length > 0) {
            const game = games[0] as Info
            await db.transact(db.tx.games[game.id]!.unlink({ owners: user.id }))

            return "ok"
        }

        return null
    })

}