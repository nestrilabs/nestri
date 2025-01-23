// import { z } from "zod"
// import { fn } from "../utils";
// import { Games } from "../game"
// import { Common } from "../common";
// import { Examples } from "../examples";
// import { useCurrentUser } from "../actor";
// import databaseClient from "../database"
// import { id as createID } from "@instantdb/admin";
// import { groupBy, map, pipe, values } from "remeda"
// export module Machines {
//     export const Info = z
//         .object({
//             id: z.string().openapi({
//                 description: Common.IdDescription,
//                 example: Examples.Machine.id,
//             }),
//             hostname: z.string().openapi({
//                 description: "The Linux hostname that identifies this machine",
//                 example: Examples.Machine.hostname,
//             }),
//             fingerprint: z.string().openapi({
//                 description: "A unique identifier derived from the machine's Linux machine ID.",
//                 example: Examples.Machine.fingerprint,
//             }),
//             createdAt: z.string().or(z.number()).openapi({
//                 description: "Represents a machine running on the Nestri network, containing its identifying information and metadata.",
//                 example: Examples.Machine.createdAt,
//             })
//         })
//         .openapi({
//             ref: "Machine",
//             description: "Represents a physical or virtual machine connected to the Nestri network..",
//             example: Examples.Machine,
//         });

//     export type Info = z.infer<typeof Info>;

//     export const create = fn(Info.pick({ fingerprint: true, hostname: true }), async (input) => {
//         const id = createID()
//         const now = new Date().toISOString()
//         const db = databaseClient()
//         await db.transact(
//             db.tx.machines[id]!.update({
//                 fingerprint: input.fingerprint,
//                 hostname: input.hostname,
//                 createdAt: now,
//                 //Just in case it had been previously deleted
//                 deletedAt: undefined
//             })
//         )

//         return id
//     })

//     export const fromID = fn(z.string(), async (id) => {
//         const db = databaseClient()

//         const query = {
//             machines: {
//                 $: {
//                     where: {
//                         id: id,
//                         deletedAt: { $isNull: true }
//                     }
//                 }
//             }
//         }

//         const res = await db.query(query)
//         const machines = res.machines

//         if (machines && machines.length > 0) {
//             const result = pipe(
//                 machines,
//                 groupBy(x => x.id),
//                 values(),
//                 map((group): Info => ({
//                     id: group[0].id,
//                     fingerprint: group[0].fingerprint,
//                     hostname: group[0].hostname,
//                     createdAt: group[0].createdAt
//                 }))
//             )
//             return result
//         }

//         return null
//     })

//     export const installedGames = fn(z.string(), async (id) => {
//         const db = databaseClient()

//         const query = {
//             machines: {
//                 $: {
//                     where: {
//                         id: id,
//                         deletedAt: { $isNull: true }
//                     }
//                 },
//                 games: {}
//             }
//         }

//         const res = await db.query(query)
//         const machines = res.machines

//         if (machines && machines.length > 0) {
//             const games = machines[0]?.games as any
//             if (games.length > 0) {
//                 return games as Games.Info[]
//             }
//             return null
//         }

//         return null
//     })

//     export const fromFingerprint = fn(z.string(), async (input) => {
//         const db = databaseClient()

//         const query = {
//             machines: {
//                 $: {
//                     where: {
//                         fingerprint: input,
//                         deletedAt: { $isNull: true }
//                     }
//                 }
//             }
//         }

//         const res = await db.query(query)

//         const machines = res.machines

//         if (machines.length > 0) {
//             const result = pipe(
//                 machines,
//                 groupBy(x => x.id),
//                 values(),
//                 map((group): Info => ({
//                     id: group[0].id,
//                     fingerprint: group[0].fingerprint,
//                     hostname: group[0].hostname,
//                     createdAt: group[0].createdAt
//                 }))
//             )
//             return result[0]
//         }

//         return null
//     })

//     export const list = async () => {
//         const user = useCurrentUser()
//         const db = databaseClient()

//         const query = {
//             $users: {
//                 $: { where: { id: user.id } },
//                 machines: {
//                     $: {
//                         where: {
//                             deletedAt: { $isNull: true }
//                         }
//                     }
//                 }
//             },
//         }

//         const res = await db.query(query)

//         const machines = res.$users[0]?.machines
//         if (machines && machines.length > 0) {
//             const result = pipe(
//                 machines,
//                 groupBy(x => x.id),
//                 values(),
//                 map((group): Info => ({
//                     id: group[0].id,
//                     fingerprint: group[0].fingerprint,
//                     hostname: group[0].hostname,
//                     createdAt: group[0].createdAt
//                 }))
//             )
//             return result
//         }
//         return null
//     }

//     export const linkToCurrentUser = fn(z.string(), async (id) => {
//         const user = useCurrentUser()
//         const db = databaseClient()

//         await db.transact(db.tx.machines[id]!.link({ owner: user.id }))

//         return "ok"
//     })

//     export const unLinkFromCurrentUser = fn(z.string(), async (id) => {
//         const user = useCurrentUser()
//         const db = databaseClient()
//         const now = new Date().toISOString()

//         const query = {
//             $users: {
//                 $: { where: { id: user.id } },
//                 machines: {
//                     $: {
//                         where: {
//                             id,
//                             deletedAt: { $isNull: true }
//                         }
//                     }
//                 }
//             },
//         }

//         const res = await db.query(query)
//         const machines = res.$users[0]?.machines
//         if (machines && machines.length > 0) {
//             const machine = machines[0] as Info
//             await db.transact(db.tx.machines[machine.id]!.update({ deletedAt: now }))

//             return "ok"
//         }

//         return null
//     })

// }