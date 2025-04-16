import { z } from "zod";
import { Resource } from "sst";
import { bus } from "sst/aws/bus";
import { useTeam } from "../actor";
import { Common } from "../common";
import { createID, fn } from "../utils";
import { createEvent } from "../event";
import { Examples } from "../examples";
import { memberTable, role } from "./member.sql";
import { and, eq, sql, asc, isNull } from "../drizzle";
import { afterTx, createTransaction, useTransaction } from "../drizzle/transaction";

export namespace Member {
    export const Info = z
        .object({
            id: z.string().openapi({
                description: Common.IdDescription,
                example: Examples.Member.id,
            }),
            timeSeen: z.date().nullable().or(z.undefined()).openapi({
                description: "The last time this team member was active",
                example: Examples.Member.timeSeen
            }),
            teamID: z.string().openapi({
                description: "The unique id of the team this member is on",
                example: Examples.Member.teamID
            }),
            role: z.enum(role).openapi({
                description: "The role of this team member",
                example: Examples.Member.role
            }),
            email: z.string().openapi({
                description: "The email of this team member",
                example: Examples.Member.email
            })
        })
        .openapi({
            ref: "Member",
            description: "Represents a team member on Nestri",
            example: Examples.Member,
        });

    export type Info = z.infer<typeof Info>;

    export const Events = {
        Created: createEvent(
            "member.created",
            z.object({
                memberID: Info.shape.id,
            }),
        ),
        Updated: createEvent(
            "member.updated",
            z.object({
                memberID: Info.shape.id,
            }),
        ),
    };

    export const create = fn(
        Info.pick({ email: true, id: true })
            .partial({
                id: true,
            })
            .extend({
                first: z.boolean().optional(),
            }),
        (input) =>
            createTransaction(async (tx) => {
                const id = input.id ?? createID("member");
                await tx.insert(memberTable).values({
                    id,
                    teamID: useTeam(),
                    email: input.email,
                    role: input.first ? "owner" : "member",
                    timeSeen: input.first ? sql`now()` : null,
                })

                await afterTx(() =>
                    async () => bus.publish(Resource.Bus, Events.Created, { memberID: id }),
                );
                return id;
            }),
    );

    export const remove = fn(Info.shape.id, (id) =>
        useTransaction(async (tx) => {
            await tx
                .update(memberTable)
                .set({
                    timeDeleted: sql`now()`,
                })
                .where(and(eq(memberTable.id, id), eq(memberTable.teamID, useTeam())))
                .execute();
            return id;
        }),
    );

    export const fromEmail = fn(z.string(), async (email) =>
        useTransaction(async (tx) =>
            tx
                .select()
                .from(memberTable)
                .where(and(eq(memberTable.email, email), isNull(memberTable.timeDeleted)))
                .orderBy(asc(memberTable.timeCreated))
                .then((rows) => rows.map(serialize).at(0))
        )
    )

    export const fromID = fn(z.string(), async (id) =>
        useTransaction(async (tx) =>
            tx
                .select()
                .from(memberTable)
                .where(and(eq(memberTable.id, id), isNull(memberTable.timeDeleted)))
                .orderBy(asc(memberTable.timeCreated))
                .then((rows) => rows.map(serialize).at(0))
        ),
    )

    /**
     * Converts a raw member database row into a standardized {@link Member.Info} object.
     *
     * @param input - The database row representing a member.
     * @returns The member information formatted as a {@link Member.Info} object.
     */
    export function serialize(
        input: typeof memberTable.$inferSelect,
    ): z.infer<typeof Info> {
        return {
            id: input.id,
            role: input.role,
            email: input.email,
            teamID: input.teamID,
            timeSeen: input.timeSeen
        };
    }

}