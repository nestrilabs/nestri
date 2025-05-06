import { z } from "zod"
import { User } from "../user";
import { Team } from "../team";
import { Actor } from "../actor";
import { Examples } from "../examples";
import { ErrorCodes, VisibleError } from "../error";

export namespace Account {
    export const Info =
        User.Info
            .extend({
                teams: Team.Info
                    .array()
                    .openapi({
                        description: "The teams that this user is part of",
                        example: [Examples.Team]
                    })
            })
            .openapi({
                ref: "Account",
                description: "Represents an account's information stored on Nestri",
                example: { ...Examples.User, teams: [Examples.Team] },
            });

    export type Info = z.infer<typeof Info>;

    export const list = async (): Promise<Info> => {
        const [userResult, teamsResult] =
            await Promise.allSettled([
                User.fromID(Actor.userID()),
                Team.list()
            ])

        if (userResult.status === "rejected" || !userResult.value)
            throw new VisibleError(
                "not_found",
                ErrorCodes.NotFound.RESOURCE_NOT_FOUND,
                "User not found",
            );

        return {
            ...userResult.value,
            teams: teamsResult.status === "rejected" ? [] : teamsResult.value
        }
    }

}