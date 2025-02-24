import { z } from "zod";
import { createEvent } from "../event";
import { VisibleError } from "../error";
import { Common } from "../common";
import { Examples } from "../examples";
import { createID } from "../utils";

export module Team {
    export const Info = z
        .object({
            id: z.string().openapi({
                description: Common.IdDescription,
                example: Examples.Team.id,
            }),
            slug: z.string().openapi({
                description: "The unique name of this team",
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

    // export const create = () => {
    //     const id = createID("user")



    // }

}