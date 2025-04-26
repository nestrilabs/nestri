import { z } from "zod";
// import { useUser } from "../actor";
import { Common } from "../common";
import { teamTable } from "./team.sql";
import { Examples } from "../examples";
import { createID, fn } from "../utils";
// import { and, eq, sql } from "../drizzle";
// import { memberTable } from "../member/member.sql";
// import { groupBy, map, pipe, values } from "remeda";
// import { subscriptionTable } from "../subscription/subscription.sql";
import { createTransaction } from "../drizzle/transaction";

export namespace Team {
    export const Info = z
        .object({
            id: z.string().openapi({
                description: Common.IdDescription,
                example: Examples.Team.id,
            }),
            name: z.string().openapi({
                description: "The name of the team",
                example: Examples.Team.name
            }),
            ownerID: z.string().openapi({
                description: "The userID of the owner of this team",
                example: Examples.Team.ownerID
            }),
            machineID: z.string().openapi({
                description: "The machineID of the machine this team uses",
                example: Examples.Team.machineID
            })
        })
        .openapi({
            ref: "Team",
            description: "Represents a team on Nestri",
            example: Examples.Team,
        });

    export type Info = z.infer<typeof Info>;

    export const create = fn(
        Info.
            partial({
                id: true,
            }),
        (input) =>
            createTransaction(async (tx) => {
                const id = input.id ?? createID("team");
                await tx
                    .insert(teamTable)
                    .values({
                        id,
                        name: input.name,
                        ownerID: input.ownerID,
                        machineID: input.machineID,
                    })

                return id;
            })
    )

    //TODO: "Delete" subscription and member(s) as well
    // export const remove = fn(
    //     Info.shape.id.min(1),
    //     (input) =>
    //         useTransaction(async (tx) => {
    //             const user = useUser();
    //             const row = await tx
    //                 .select({
    //                     teamID: memberTable.teamID,
    //                 })
    //                 .from(memberTable)
    //                 .where(
    //                     and(
    //                         eq(memberTable.teamID, input),
    //                         eq(memberTable.email, user.email),
    //                     ),
    //                 )
    //                 .execute()
    //                 .then((rows) => rows.at(0));
    //             if (!row) return;
    //             await tx
    //                 .update(teamTable)
    //                 .set({
    //                     timeDeleted: sql`now()`,
    //                 })
    //                 .where(eq(teamTable.id, row.teamID));
    //         })
    // );

    // export const list = fn(z.void(), () => {
    //     const user = useUser();
    //     return useTransaction(async (tx) =>
    //         tx
    //             .select()
    //             .from(teamTable)
    //             .leftJoin(subscriptionTable, eq(subscriptionTable.teamID, teamTable.id))
    //             .innerJoin(memberTable, eq(memberTable.teamID, teamTable.id))
    //             .where(
    //                 and(
    //                     eq(memberTable.email, user.email),
    //                     isNull(memberTable.timeDeleted),
    //                     isNull(teamTable.timeDeleted),
    //                 ),
    //             )
    //             .execute()
    //             .then((rows) => serializeFull(rows))
    //     )
    // });

    // export const fromID = fn(
    //     Info.shape.id.min(1),
    //     async (id) =>
    //         useTransaction(async (tx) =>
    //             tx
    //                 .select()
    //                 .from(teamTable)
    //                 .leftJoin(subscriptionTable, eq(subscriptionTable.teamID, teamTable.id))
    //                 .innerJoin(memberTable, eq(memberTable.teamID, teamTable.id))
    //                 .where(
    //                     and(
    //                         eq(teamTable.id, id),
    //                         isNull(memberTable.timeDeleted),
    //                         isNull(teamTable.timeDeleted),
    //                     ),
    //                 )
    //                 .execute()
    //                 .then((rows) => serializeFull(rows).at(0))
    //         ),
    // );

    /**
   * Transforms an array of team, subscription, and member records into structured team objects.
   *
   * Groups input rows by team ID and constructs an array of team objects, each including its associated members and subscriptions.
   *
   * @param input - Array of objects containing team, subscription, and member data.
   * @returns An array of team objects with their members and subscriptions.
   */
    // export function serializeFull(
    //     input: typeof teamTable.$inferSelect,
    // ): z.infer<typeof Info>[] {
    //     return pipe(
    //         input,
    //         groupBy((row) => row.team.id),
    //         values(),
    //         map((group) => ({
    //             ...serializeBasic(group[0].team),
    //             subscriptions: !group[0].subscription ?
    //                 [] :
    //                 group.map((item) => Subscription.serializeBasic(item.subscription!)),
    //             members:
    //                 !group[0].member ?
    //                     [] :
    //                     group.map((item) => Member.serializeBasic(item.member!))
    //         })),
    //     );
    // }

    export function serialize(
        input: typeof teamTable.$inferSelect
    ): z.infer<typeof Info> {
        return {
            name: input.name,
            id: input.id,
            ownerID: input.ownerID,
            machineID: input.machineID
        }
    }
}