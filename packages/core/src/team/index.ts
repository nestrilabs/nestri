import { z } from "zod";
import { Resource } from "sst";
import { bus } from "sst/aws/bus";
import { Common } from "../common";
import { createID, fn } from "../utils";
import { VisibleError } from "../error";
import { Examples } from "../examples";
import { teamTable } from "./team.sql";
import { createEvent } from "../event";
import { assertActor } from "../actor";
import { and, eq, sql } from "../drizzle";
import { memberTable } from "../member/member.sql";
import { afterTx, createTransaction, useTransaction } from "../drizzle/transaction";

export module Team {
    export const Info = z
        .object({
            id: z.string().openapi({
                description: Common.IdDescription,
                example: Examples.Team.id,
            }),
            slug: z.string().openapi({
                description: "The unique and url-friendly slug of this team",
                example: Examples.Team.slug
            }),
            name: z.string().openapi({
                description: "The name of this team",
                example: Examples.Team.name
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

    export class WorkspaceExistsError extends VisibleError {
        constructor(slug: string) {
            super(
                "team.slug_exists",
                `there is already a workspace named "${slug}"`,
            );
        }
    }

    export const create = fn(
        Info.pick({ slug: true, id: true, name: true }).partial({
            id: true,
        }), (input) => {
            createTransaction(async (tx) => {
                const id = input.id ?? createID("team");
                const result = await tx.insert(teamTable).values({
                    id,
                    slug: input.slug,
                    name: input.name
                })
                    .onConflictDoNothing()
                    .returning({ insertedID: teamTable.id })

                if (result.length === 0) throw new WorkspaceExistsError(input.slug);

                await afterTx(() =>
                    bus.publish(Resource.Bus, Events.Created, {
                        teamID: id,
                    }),
                );
                return id;
            })
        })

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
                .then((rows) => rows.map(serialize))
                .then((rows) => rows.at(0));
        }),
    );

    export const fromSlug = fn(z.string().min(1), async (input) =>
        useTransaction(async (tx) => {
            return tx
                .select()
                .from(teamTable)
                .where(eq(teamTable.slug, input))
                .execute()
                .then((rows) => rows.map(serialize))
                .then((rows) => rows.at(0));
        }),
    );

    export function serialize(
        input: typeof teamTable.$inferSelect,
    ): z.infer<typeof Info> {
        return {
            id: input.id,
            name: input.name,
            slug: input.slug,
        };
    }

}