import { z } from "zod";
import { Common } from "../common";
import { Examples } from "../examples";

export module Member {
    export const Info = z
        .object({
            id: z.string().openapi({
                description: Common.IdDescription,
                example: Examples.Member.id,
            }),
            timeSeen: z.string().openapi({
                description: "The last time this team member was active",
                example: Examples.Member.timeSeen
            }),
            teamID: z.string().openapi({
                description: "The unique id of the team this member is on",
                example: Examples.Member.teamID
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

        
}