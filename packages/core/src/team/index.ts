import { z } from "zod";
import { Resource } from "sst";
import { bus } from "sst/aws/bus";
import { Common } from "../common";
import { Examples } from "../examples";
import { createEvent } from "../event";
import { createID, fn } from "../utils";
import { and, eq, sql } from "../drizzle";
import { PlanType, teamTable } from "./team.sql";
import { assertActor, withActor } from "../actor";
import { memberTable } from "../member/member.sql";
import { ErrorCodes, VisibleError } from "../error";
import { afterTx, createTransaction, useTransaction } from "../drizzle/transaction";

export module Team {
    export const Info = z
        .object({
            id: z.string().openapi({
                description: Common.IdDescription,
                example: Examples.Team.id,
            }),
            slug: z.string().regex(/^[a-z0-9\-]+$/, "Use a URL friendly name.").openapi({
                description: "The unique and url-friendly slug of this team",
                example: Examples.Team.slug
            }),
            name: z.string().openapi({
                description: "The name of this team",
                example: Examples.Team.name
            }),
            planType: z.enum(PlanType).openapi({
                description: "The type of Plan this team is subscribed to",
                example: Examples.Team.planType
            })
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
        Info.pick({ slug: true, id: true, name: true, planType: true }).partial({
            id: true,
        }), (input) =>
        createTransaction(async (tx) => {
            const id = input.id ?? createID("team");
            const result = await tx.insert(teamTable).values({
                id,
                //Remove spaces and make sure it is lowercase (this is just to make sure the frontend did this)
                slug: input.slug, //.toLowerCase().replace(/[\s]/g, ''),
                planType: input.planType,
                name: input.name
            })
                .onConflictDoNothing({ target: teamTable.slug })

            if (result.count === 0) throw new TeamExistsError(input.slug);

            return id;
        })
    )

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

    export const list = fn(z.void(), () =>
        useTransaction((tx) =>
            tx
                .select()
                .from(teamTable)
                .execute()
                .then((rows) => rows.map(serialize)),
        ),
    );

    export const fromID = fn(z.string().min(1), async (id) =>
        useTransaction(async (tx) => {
            return tx
                .select()
                .from(teamTable)
                .where(eq(teamTable.id, id))
                .execute()
                .then((rows) => rows.map(serialize).at(0))
        }),
    );

    export const fromSlug = fn(z.string().min(1), async (input) =>
        useTransaction(async (tx) => {
            return tx
                .select()
                .from(teamTable)
                .where(eq(teamTable.slug, input))
                .execute()
                .then((rows) => rows.map(serialize).at(0))
        }),
    );

    export function serialize(
        input: typeof teamTable.$inferSelect,
    ): z.infer<typeof Info> {
        return {
            id: input.id,
            name: input.name,
            slug: input.slug,
            planType: input.planType,
        };
    }

}