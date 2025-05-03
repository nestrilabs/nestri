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

    export const list = async () => {
        const [user, teams] = await Promise.allSettled([User.fromID(Actor.userID()), Team.list()])

        if (user.status === "rejected" || !user.value)
            throw new VisibleError(
                "not_found",
                ErrorCodes.NotFound.RESOURCE_NOT_FOUND,
                "User not found",
            );

        return {
            ...user.value,
            teams: teams.status === "rejected" ? [] : teams.value
        }
    }

}