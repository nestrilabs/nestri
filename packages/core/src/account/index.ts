import { z } from "zod"
import { User } from "../user";
import { Steam } from "../steam";
import { Actor } from "../actor";
import { Examples } from "../examples";
import { ErrorCodes, VisibleError } from "../error";

export namespace Account {
    export const Info =
        User.Info
            .extend({
                profiles: Steam.Info
                    .array()
                    .openapi({
                        description: "The Steam accounts this user owns",
                        example: [Examples.SteamAccount]
                    })
            })
            .openapi({
                ref: "Account",
                description: "Represents an account's information stored on Nestri",
                example: { ...Examples.User, profiles: [Examples.SteamAccount] },
            });

    export type Info = z.infer<typeof Info>;

    export const list = async (): Promise<Info> => {
        const [userResult, steamResult] =
            await Promise.allSettled([
                User.fromID(Actor.userID()),
                Steam.list()
            ])

        if (userResult.status === "rejected" || !userResult.value)
            throw new VisibleError(
                "not_found",
                ErrorCodes.NotFound.RESOURCE_NOT_FOUND,
                "User not found",
            );

        return {
            ...userResult.value,
            profiles: steamResult.status === "rejected" ? [] : steamResult.value
        }
    }

}