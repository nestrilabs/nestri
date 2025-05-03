import { User } from "../user";
import { Team } from "../team";
import { Actor } from "../actor";
import { Steam } from "../steam";
import { Examples } from "../examples";
import { ErrorCodes, VisibleError } from "../error";

export namespace Account {
    export const Info = User.Info
        .extend({
            teams: Team.Info
                .extend({
                    members: Steam.Info
                        .array()
                        .openapi({
                            description: "The team members of this team",
                            example: [Examples.SteamAccount]
                        })
                })
                .array()
                .openapi({
                    description: "The teams that this user is part of",
                    example: [{ ...Examples.Team, members: [Examples.SteamAccount] }]
                })
        })
        .openapi({
            ref: "Account",
            description: "Represents an account's information stored on Nestri",
            example: { ...Examples.User, teams: [{ ...Examples.Team, members: [Examples.SteamAccount] }] },
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