import { z } from "zod";
import { Steam } from "../steam";
import { Actor } from "../actor";
import { Common } from "../common";
import { teamTable } from "./team.sql";
import { Examples } from "../examples";
import { and, eq, isNull } from "../drizzle";
import { steamTable } from "../steam/steam.sql";
import { memberTable } from "../member/member.sql";
import { groupBy, pipe, values, map } from "remeda";
import { createID, fn, generateTeamInviteCode } from "../utils";
import { createTransaction, useTransaction, type Transaction } from "../drizzle/transaction";

export namespace Team {
    export const Info = z
        .object({
            id: z.string().openapi({
                description: Common.IdDescription,
                example: Examples.Team.id,
            }),
            slug: z.string().regex(/^[a-z0-9]{1,32}$/, "Use a URL friendly name.").openapi({
                description: "URL-friendly unique username (lowercase alphanumeric with hyphens)",
                example: Examples.Team.slug
            }),
            name: z.string().openapi({
                description: "Display name of the team",
                example: Examples.Team.name
            }),
            ownerID: z.string().openapi({
                description: "Unique identifier of the team owner",
                example: Examples.Team.ownerID
            }),
            maxMembers: z.number().openapi({
                description: "Maximum allowed team members based on subscription tier",
                example: Examples.Team.maxMembers
            }),
            inviteCode: z.string().openapi({
                description: "Unique invitation code used for adding new team members",
                example: Examples.Team.inviteCode
            }),
            members: Steam.Info.array().openapi({
                description: "All the team members in this team",
                example: Examples.Team.members
            })
        })
        .openapi({
            ref: "Team",
            description: "Team entity containing core team information and settings",
            example: Examples.Team,
        });

    export type Info = z.infer<typeof Info>;

    /**
     * Generates a unique team invite code
     * @param length The length of the invite code
     * @param maxAttempts Maximum number of attempts to generate a unique code
     * @returns A promise resolving to a unique invite code
     */
    async function createUniqueTeamInviteCode(
        tx: Transaction,
        length: number = 8,
        maxAttempts: number = 5
    ): Promise<string> {
        let attempts = 0;

        while (attempts < maxAttempts) {
            const code = generateTeamInviteCode(length);

            const teams =
                await tx
                    .select()
                    .from(teamTable)
                    .where(eq(teamTable.inviteCode, code))

            if (teams.length === 0) {
                return code;
            }

            attempts++;
        }

        // If we've exceeded max attempts, add timestamp to ensure uniqueness
        const timestampSuffix = Date.now().toString(36).slice(-4);
        const baseCode = generateTeamInviteCode(length - 4);
        return baseCode + timestampSuffix;
    }

    export const create = fn(
        Info
            .omit({ members: true })
            .partial({
                id: true,
                inviteCode: true,
                maxMembers: true,
                ownerID: true
            }),
        async (input) =>
            createTransaction(async (tx) => {
                const inviteCode = await createUniqueTeamInviteCode(tx)
                const id = input.id ?? createID("team");
                await tx
                    .insert(teamTable)
                    .values({
                        id,
                        inviteCode,
                        slug: input.slug,
                        name: input.name,
                        ownerID: input.ownerID ?? Actor.userID(),
                        maxMembers: input.maxMembers ?? 1,
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

    export const list = () =>
        useTransaction(async (tx) =>
            tx
                .select({
                    steam_accounts: steamTable,
                    teams: teamTable
                })
                .from(teamTable)
                .innerJoin(memberTable, eq(memberTable.teamID, teamTable.id))
                .innerJoin(steamTable, eq(memberTable.steamID, steamTable.id))
                .where(
                    and(
                        eq(memberTable.userID, Actor.userID()),
                        isNull(memberTable.timeDeleted),
                        isNull(steamTable.timeDeleted),
                        isNull(teamTable.timeDeleted),
                    ),
                )
                .execute()
                .then((rows) => serialize(rows))
        )

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
        input: { teams: typeof teamTable.$inferSelect; steam_accounts: typeof steamTable.$inferSelect | null }[]
    ): z.infer<typeof Info>[] {
        return pipe(
            input,
            groupBy((row) => row.teams.id),
            values(),
            map((group) => ({
                // ...serialize(group[0].teams),
                id: group[0].teams.id,
                slug: group[0].teams.slug,
                name: group[0].teams.name,
                ownerID: group[0].teams.ownerID,
                maxMembers: group[0].teams.maxMembers,
                inviteCode: group[0].teams.inviteCode,
                members:
                    !group[0].steam_accounts ?
                        [] :
                        group.map((item) => Steam.serialize(item.steam_accounts!))
            })),
        )
        // return {
        //     id: input.id,
        //     slug: input.slug,
        //     name: input.name,
        //     ownerID: input.ownerID,
        //     maxMembers: input.maxMembers,
        //     inviteCode: input.inviteCode,
        // }
    }
}