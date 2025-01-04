import { z } from "zod"
import { fn } from "../utils";
import { Common } from "../common";
import { Examples } from "../examples";
import databaseClient from "../database"
import { id as createID } from "@instantdb/admin";
import { groupBy, map, pipe, values } from "remeda"

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
        await db.transact(
            db.tx.games[id]!.update({
                name: input.name,
                steamID: input.steamID,
            })
        )

        return id
    })
}