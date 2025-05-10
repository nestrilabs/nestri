import { z } from "zod";
import { Actor } from "../actor";
import { Common } from "../common";
import { Examples } from "../examples";
import { createID, fn } from "../utils";
import { and, eq, isNull } from "drizzle-orm"
import { memberTable, RoleEnum } from "./member.sql";
import { createTransaction, useTransaction } from "../drizzle/transaction";

export namespace Member {
    export const Info = z
        .object({
            id: z.string().openapi({
                description: Common.IdDescription,
                example: Examples.Member.id,
            }),
            teamID: z.string().openapi({
                description: "Associated team identifier for this membership",
                example: Examples.Member.teamID
            }),
            role: z.enum(RoleEnum.enumValues).openapi({
                description: "Assigned permission role within the team",
                example: Examples.Member.role
            }),
            steamID: z.string().openapi({
                description: "Steam platform identifier for Steam account integration",
                example: Examples.Member.steamID
            }),
            userID: z.string().nullable().openapi({
                description: "Optional associated user account identifier",
                example: Examples.Member.userID
            }),
        })
        .openapi({
            ref: "Member",
            description: "Team membership entity defining user roles and platform connections",
            example: Examples.Member,
        });

    export type Info = z.infer<typeof Info>;

    export const create = fn(
        Info
            .partial({
                id: true,
                userID: true,
                teamID: true
            }),
        (input) =>
            createTransaction(async (tx) => {
                const id = input.id ?? createID("member");
                await tx.insert(memberTable).values({
                    id,
                    role: input.role,
                    userID: input.userID,
                    steamID: input.steamID,
                    teamID: input.teamID ?? Actor.teamID(),
                })

                return id;
            }),
    );

    export const fromTeamID = fn(
        Info.shape.teamID,
        (teamID) =>
            useTransaction((tx) =>
                tx
                    .select()
                    .from(memberTable)
                    .where(
                        and(
                            eq(memberTable.userID, Actor.userID()),
                            eq(memberTable.teamID, teamID),
                            isNull(memberTable.timeDeleted)
                        )
                    )
                    .execute()
                    .then(rows => rows.map(serialize).at(0))
            )

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
            userID: input.userID,
            teamID: input.teamID,
            steamID: input.steamID
        };
    }

}