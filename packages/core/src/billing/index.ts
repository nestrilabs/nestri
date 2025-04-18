import { z } from "zod";
import { Common } from "../common";
import { Examples } from "../examples";
import { CreditsType } from "./billing.sql";

export namespace Billing {
    export const Info = z.object({
        id: z.string().openapi({
            description: Common.IdDescription,
            example: Examples.Usage.id,
        }),
        creditsUsed: z.number().openapi({
            description: "The credits used",
            example: Examples.Usage.creditsUsed
        }),
        type: z.enum(CreditsType).openapi({
            description: "The type of credits this was billed on"
        }),
        // game: 
        // session:
    })
        .openapi({
            ref: "Billing",
            description: "Represents a usage billing",
            example: Examples.Usage,
        });
}