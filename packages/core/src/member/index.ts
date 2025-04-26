import { z } from "zod";
import { Common } from "../common";
import { Examples } from "../examples";
import { createID, fn } from "../utils";
import { memberTable, role } from "./member.sql";
import { useSteamID, useTeam, useUserID } from "../actor";
import { createTransaction } from "../drizzle/transaction";

export namespace Member {
    export const Info = z
        .object({
            id: z.string().openapi({
                description: Common.IdDescription,
                example: Examples.Member.id,
            }),
            teamID: z.string().openapi({
                description: "The unique id of the team this member is on",
                example: Examples.Member.teamID
            }),
            role: z.enum(role).openapi({
                description: "The role of this team member",
                example: Examples.Member.role
            }),
            steamID: z.bigint().nullable().openapi({
                description: "The steamID of this team member",
                example: Examples.Member.steamID
            }),
            userID: z.string().nullable().openapi({
                description: "The userID of this team member",
                example: Examples.Member.userID
            }),
        })
        .openapi({
            ref: "Member",
            description: "Represents a team member on Nestri",
            example: Examples.Member,
        });

    export type Info = z.infer<typeof Info>;

    export const create = fn(
        Info
            .partial({
                id: true,
                steamID: true,
                userID: true
            })
            .extend({
                first: z.boolean().optional(),
            }),
        (input) =>
            createTransaction(async (tx) => {
                const id = input.id ?? createID("member");
                await tx.insert(memberTable).values({
                    id,
                    role: input.role,
                    teamID: input.teamID ?? useTeam(),
                    steamID: input.steamID ,
                    userID: input.userID,
                })

                // await afterTx(() =>
                //     async () => bus.publish(Resource.Bus, Events.Created, { memberID: id }),
                // );
                return id;
            }),
    );

    // export const remove = fn(
    //     BasicInfo.shape.id,
    //     (id) =>
    //         useTransaction(async (tx) => {
    //             await tx
    //                 .update(memberTable)
    //                 .set({
    //                     timeDeleted: sql`now()`,
    //                 })
    //                 .where(and(eq(memberTable.id, id), eq(memberTable.teamID, useTeam())))
    //                 .execute();
    //             return id;
    //         }),
    // );

    // export const fromEmail = fn(
    //     BasicInfo.shape.email,
    //     async (email) =>
    //         useTransaction(async (tx) =>
    //             tx
    //                 .select()
    //                 .from(memberTable)
    //                 .where(and(eq(memberTable.email, email), eq(memberTable.teamID, useTeam()), isNull(memberTable.timeDeleted)))
    //                 .orderBy(asc(memberTable.timeCreated))
    //                 .then((rows) => rows.map(serializeBasic).at(0))
    //         )
    // )

    // export const fromID = fn(
    //     BasicInfo.shape.id,
    //     async (id) =>
    //         useTransaction(async (tx) =>
    //             tx
    //                 .select()
    //                 .from(memberTable)
    //                 .where(and(eq(memberTable.id, id), eq(memberTable.teamID, useTeam()), isNull(memberTable.timeDeleted)))
    //                 .orderBy(asc(memberTable.timeCreated))
    //                 .then((rows) => rows.map(serializeBasic).at(0))
    //         ),
    // )

    // export const nowSeen = fn(
    //     BasicInfo.shape.email,
    //     async (email) =>
    //         useTransaction(async (tx) =>
    //             tx
    //                 .update(memberTable)
    //                 .set({
    //                     timeSeen: sql`now()`
    //                 })
    //                 .where(and(eq(memberTable.email, email), isNull(memberTable.timeDeleted)))
    //                 .execute()
    //         ),
    // )

    /**
     * Converts a raw member database row into a standardized {@link Member.Info} object.
     *
     * @param input - The database row representing a member.
     * @returns The member information formatted as a {@link Member.Info} object.
     */
    export function serializeBasic(
        input: typeof memberTable.$inferSelect,
    ): z.infer<typeof Info> {
        return {
            id: input.id,
            role: input.role,
            userID: input.userID,
            teamID: input.teamID,
            steamID: input.steamID
        };
    }

}