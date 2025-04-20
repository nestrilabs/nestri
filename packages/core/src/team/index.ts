import { z } from "zod";
import { Common } from "../common";
import { Member } from "../member";
import { teamTable } from "./team.sql";
import { Examples } from "../examples";
import { assertActor } from "../actor";
import { createEvent } from "../event";
import { createID, fn } from "../utils";
import { Subscription } from "../subscription";
import { and, eq, sql, isNull } from "../drizzle";
import { memberTable } from "../member/member.sql";
import { ErrorCodes, VisibleError } from "../error";
import { groupBy, map, pipe, values } from "remeda";
import { subscriptionTable } from "../subscription/subscription.sql";
import { createTransaction, useTransaction } from "../drizzle/transaction";

export namespace Team {
    export const Info = z
        .object({
            id: z.string().openapi({
                description: Common.IdDescription,
                example: Examples.Team.id,
            }),
            // Remove spaces and make sure it is lowercase (this is just to make sure the frontend did this)
            slug: z.string().regex(/^[a-z0-9\-]+$/, "Use a URL friendly name.").openapi({
                description: "The unique and url-friendly slug of this team",
                example: Examples.Team.slug
            }),
            name: z.string().openapi({
                description: "The name of this team",
                example: Examples.Team.name
            }),
            members: Member.Info.array().openapi({
                description: "The members of this team",
                example: Examples.Team.members
            }),
            subscriptions: Subscription.Info.array().openapi({
                description: "The subscriptions of this team",
                example: Examples.Team.subscriptions
            }),
        })
        .openapi({
            ref: "Team",
            description: "Represents a team on Nestri",
            example: Examples.Team,
        });

    export type Info = z.infer<typeof Info>;

    export const Events = {
        Created: createEvent(
            "team.created",
            z.object({
                teamID: z.string().nonempty(),
            }),
        ),
    };

    export class TeamExistsError extends VisibleError {
        constructor(slug: string) {
            super(
                "already_exists",
                ErrorCodes.Validation.TEAM_ALREADY_EXISTS,
                `There is already a team named "${slug}"`
            );
        }
    }

    export const create = fn(
        Info.pick({ slug: true, id: true, name: true, }).partial({
            id: true,
        }), (input) =>
        createTransaction(async (tx) => {
            const id = input.id ?? createID("team");
            const result = await tx.insert(teamTable).values({
                id,
                slug: input.slug,
                name: input.name
            })
                .onConflictDoNothing({ target: teamTable.slug })

            if (result.count === 0) throw new TeamExistsError(input.slug);

            return id;
        })
    )

    //TODO: "Delete" subscription and member(s) as well
    export const remove = fn(Info.shape.id, (input) =>
        useTransaction(async (tx) => {
            const account = assertActor("user");
            const row = await tx
                .select({
                    teamID: memberTable.teamID,
                })
                .from(memberTable)
                .where(
                    and(
                        eq(memberTable.teamID, input),
                        eq(memberTable.email, account.properties.email),
                    ),
                )
                .execute()
                .then((rows) => rows.at(0));
            if (!row) return;
            await tx
                .update(teamTable)
                .set({
                    timeDeleted: sql`now()`,
                })
                .where(eq(teamTable.id, row.teamID));
        }),
    );

    export const list = fn(z.void(), () => {
        const actor = assertActor("user");
        return useTransaction(async (tx) =>
            tx
                .select()
                .from(teamTable)
                .leftJoin(subscriptionTable, eq(subscriptionTable.teamID, teamTable.id))
                .innerJoin(memberTable, eq(memberTable.teamID, teamTable.id))
                .where(
                    and(
                        eq(memberTable.email, actor.properties.email),
                        isNull(memberTable.timeDeleted),
                        isNull(teamTable.timeDeleted),
                    ),
                )
                .execute()
                .then((rows) => serialize(rows))
        )
    });

    export const fromID = fn(z.string().min(1), async (id) =>
        useTransaction(async (tx) =>
            tx
                .select()
                .from(teamTable)
                .leftJoin(subscriptionTable, eq(subscriptionTable.teamID, teamTable.id))
                .innerJoin(memberTable, eq(memberTable.teamID, teamTable.id))
                .where(
                    and(
                        eq(teamTable.id, id),
                        isNull(memberTable.timeDeleted),
                        isNull(teamTable.timeDeleted),
                    ),
                )
                .execute()
                .then((rows) => serialize(rows).at(0))
        ),
    );

    export const fromSlug = fn(z.string().min(1), async (slug) =>
        useTransaction(async (tx) =>
            tx
                .select()
                .from(teamTable)
                .leftJoin(subscriptionTable, eq(subscriptionTable.teamID, teamTable.id))
                .innerJoin(memberTable, eq(memberTable.teamID, teamTable.id))
                .where(
                    and(
                        eq(teamTable.slug, slug),
                        isNull(memberTable.timeDeleted),
                        isNull(teamTable.timeDeleted),
                    ),
                )
                .execute()
                .then((rows) => serialize(rows).at(0))
        ),
    );

    /**
     * Transforms an array of team, subscription, and member records into structured team objects.
     *
     * Groups input rows by team ID and constructs an array of team objects, each including its associated members and subscriptions.
     *
     * @param input - Array of objects containing team, subscription, and member data.
     * @returns An array of team objects with their members and subscriptions.
     */
    export function serialize(
        input: { team: typeof teamTable.$inferSelect, subscription: typeof subscriptionTable.$inferInsert | null, member: typeof memberTable.$inferInsert | null }[],
    ): z.infer<typeof Info>[] {
        return pipe(
            input,
            groupBy((row) => row.team.id),
            values(),
            map((group) => ({
                name: group[0].team.name,
                id: group[0].team.id,
                slug: group[0].team.slug,
                subscriptions: !group[0].subscription ?
                    [] :
                    group.map((row) => ({
                        planType: row.subscription!.planType,
                        polarProductID: row.subscription!.polarProductID,
                        polarSubscriptionID: row.subscription!.polarSubscriptionID,
                        standing: row.subscription!.standing,
                        tokens: row.subscription!.tokens,
                        teamID: row.subscription!.teamID,
                        userID: row.subscription!.userID,
                        id: row.subscription!.id,
                    })),
                members:
                    !group[0].member ?
                        [] :
                        group.map((row) => ({
                            id: row.member!.id,
                            email: row.member!.email,
                            role: row.member!.role,
                            teamID: row.member!.teamID,
                            timeSeen: row.member!.timeSeen,
                        }))
            })),
        );
    }
}