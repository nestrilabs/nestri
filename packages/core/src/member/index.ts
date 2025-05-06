import { z } from "zod";
import { Actor } from "../actor";
import { Common } from "../common";
import { Examples } from "../examples";
import { createID, fn } from "../utils";
import { memberTable, RoleEnum } from "./member.sql";
import { createTransaction } from "../drizzle/transaction";

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
            steamID: z.bigint().openapi({
                description: "Optional Steam platform identifier for Steam account integration",
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
                    teamID: input.teamID ?? Actor.teamID(),
                    steamID: input.steamID,
                    userID: input.userID,
                })

                // await afterTx(() =>
                //     async () => bus.publish(Resource.Bus, Events.Created, { memberID: id }),
                // );
                return id;
            }),
    );

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