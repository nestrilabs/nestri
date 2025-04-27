import { z } from "zod";
// import { useUser } from "../actor";
import { Common } from "../common";
import { and, eq, isNull } from "../drizzle";
import { teamTable } from "./team.sql";
import { Examples } from "../examples";
import { createID, fn, generateTeamInviteCode } from "../utils";
// import { memberTable } from "../member/member.sql";
// import { groupBy, map, pipe, values } from "remeda";
// import { subscriptionTable } from "../subscription/subscription.sql";
import { createTransaction, useTransaction } from "../drizzle/transaction";
import { memberTable } from "../member/member.sql";
import { useUserID } from "../actor";
import { groupBy, pipe, values, map } from "remeda";
import { Member } from "../member";
import { steamTable } from "../steam/steam.sql";
import { Steam } from "../steam";

export namespace Team {
    export const Info = z
        .object({
            id: z.string().openapi({
                description: Common.IdDescription,
                example: Examples.Team.id,
            }),
            name: z.string().openapi({
                description: "Display name of the team",
                example: Examples.Team.name
            }),
            ownerID: z.string().openapi({
                description: "Unique identifier of the team owner",
                example: Examples.Team.ownerID
            }),
            machineID: z.string().openapi({
                description: "Associated machine identifier for this team",
                example: Examples.Team.machineID
            }),
            maxMembers: z.number().openapi({
                description: "Maximum allowed team members based on subscription tier",
                example: Examples.Team.maxMembers
            }),
            inviteCode: z.string().openapi({
                description: "Unique invitation code used for adding new team members",
                example: Examples.Team.inviteCode
            })
        })
        .openapi({
            ref: "Team",
            description: "Team entity containing core team information and settings",
            example: Examples.Team,
        });

    export type Info = z.infer<typeof Info>;

    // Function to check if a code already exists in the database
    async function isCodeUnique(code: string): Promise<boolean> {

        const teams = await useTransaction(async (tx) =>
            tx
                .select()
                .from(teamTable)
                .where(and(eq(teamTable.inviteCode, code)))
        )

        if (teams.length === 0) {
            return true;
        }

        return false
    }

    /**
     * Generates a unique team invite code
     * @param length The length of the invite code
     * @param maxAttempts Maximum number of attempts to generate a unique code
     * @returns A promise resolving to a unique invite code
     */
    async function createUniqueTeamInviteCode(
        length: number = 8,
        maxAttempts: number = 5
    ): Promise<string> {
        let attempts = 0;

        while (attempts < maxAttempts) {
            const code = generateTeamInviteCode(length);
            if (await isCodeUnique(code)) {
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
        Info.
            partial({
                id: true,
                inviteCode: true,
                maxMembers: true,
                ownerID: true
            }),
        async (input) => {
            const inviteCode = await createUniqueTeamInviteCode()
            return createTransaction(async (tx) => {
                const id = input.id ?? createID("team");
                await tx
                    .insert(teamTable)
                    .values({
                        id,
                        inviteCode,
                        name: input.name,
                        ownerID: input.ownerID ?? useUserID(),
                        machineID: input.machineID,
                        maxMembers: input.maxMembers ?? 1,
                    })

                return id;
            })
        })

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

    export const list = fn(
        z.void(),
        () => {
            return useTransaction(async (tx) =>
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
                            eq(memberTable.userID, useUserID()),
                            isNull(memberTable.timeDeleted),
                            isNull(teamTable.timeDeleted),
                        ),
                    )
                    .execute()
                    .then((rows) =>
                        pipe(
                            rows,
                            groupBy((row) => row.teams.id),
                            values(),
                            map((group) => ({
                                ...serialize(group[0].teams),
                                members:
                                    !group[0].steam_accounts ?
                                        [] :
                                        group.map((item) => Steam.serialize(item.steam_accounts!))
                            })),
                        )
                    )
            )
        });

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
            machineID: input.machineID,
            maxMembers: input.maxMembers,
            inviteCode: input.inviteCode
        }
    }
}