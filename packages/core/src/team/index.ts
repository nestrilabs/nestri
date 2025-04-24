import { z } from "zod";
import { useUser } from "../actor";
import { Common } from "../common";
import { Member } from "../member";
import { teamTable } from "./team.sql";
import { Examples } from "../examples";
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
    export const BasicInfo = z
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
        })
        .openapi({
            ref: "Team",
            description: "Represents a team on Nestri",
            example: Examples.Team,
        });

    export const FullInfo = BasicInfo
        .extend({
            members: Member.BasicInfo.array().openapi({
                description: "The members of this team",
                example: Examples.Team.members
            }),
            subscriptions: Subscription.BasicInfo.array().openapi({
                description: "The subscriptions of this team",
                example: Examples.Team.subscriptions
            }),
        }).openapi({
            ref: "Team",
            description: "Represents a team on Nestri",
            example: Examples.Team,
        });

    export type BasicInfo = z.infer<typeof BasicInfo>;
    export type FullInfo = z.infer<typeof FullInfo>;

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
        BasicInfo.
            partial({
                id: true,
            }),
        (input) =>
            createTransaction(async (tx) => {
                const id = input.id ?? createID("team");
                const result = await tx
                    .insert(teamTable)
                    .values({
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
    export const remove = fn(
        BasicInfo.shape.id.min(1),
        (input) =>
            useTransaction(async (tx) => {
                const user = useUser();
                const row = await tx
                    .select({
                        teamID: memberTable.teamID,
                    })
                    .from(memberTable)
                    .where(
                        and(
                            eq(memberTable.teamID, input),
                            eq(memberTable.email, user.email),
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
        const user = useUser();
        return useTransaction(async (tx) =>
            tx
                .select()
                .from(teamTable)
                .leftJoin(subscriptionTable, eq(subscriptionTable.teamID, teamTable.id))
                .innerJoin(memberTable, eq(memberTable.teamID, teamTable.id))
                .where(
                    and(
                        eq(memberTable.email, user.email),
                        isNull(memberTable.timeDeleted),
                        isNull(teamTable.timeDeleted),
                    ),
                )
                .execute()
                .then((rows) => serializeFull(rows))
        )
    });

    export const fromID = fn(
        BasicInfo.shape.id.min(1),
        async (id) =>
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
                    .then((rows) => serializeFull(rows).at(0))
            ),
    );

    export const fromSlug = fn(
        BasicInfo.shape.slug.min(1),
        async (slug) =>
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
                    .then((rows) => serializeFull(rows).at(0))
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
    export function serializeFull(
        input: { team: typeof teamTable.$inferSelect, subscription: typeof subscriptionTable.$inferSelect | null, member: typeof memberTable.$inferSelect | null }[],
    ): z.infer<typeof FullInfo>[] {
        return pipe(
            input,
            groupBy((row) => row.team.id),
            values(),
            map((group) => ({
                ...serializeBasic(group[0].team),
                subscriptions: !group[0].subscription ?
                    [] :
                    group.map((item) => Subscription.serializeBasic(item.subscription!)),
                members:
                    !group[0].member ?
                        [] :
                        group.map((item) => Member.serializeBasic(item.member!))
            })),
        );
    }

    export function serializeBasic(
        input: typeof teamTable.$inferSelect
    ): z.infer<typeof BasicInfo> {
        return {
            name: input.name,
            id: input.id,
            slug: input.slug,
        }
    }
}