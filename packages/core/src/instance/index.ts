import { z } from "zod"
import { fn } from "../utils";
import { Common } from "../common";
import { Examples } from "../examples";

export module Instance {
    export const Info = z
        .object({
            id: z.string().openapi({
                description: Common.IdDescription,
                example: Examples.Instance.id,
            }),
            hostname: z.string().openapi({
                description: "The container's hostname",
                example: Examples.Instance.hostname,
            }),
            createdAt: z.string().or(z.number()).openapi({
                description: "The time this instances was registered on the network",
                example: Examples.Instance.createdAt,
            }),
            deletedAt: z.string().or(z.number()).openapi({
                description: "The time this instance was deleted on the network",
                example: Examples.Instance.deletedAt,
            })
        })
        .openapi({
            ref: "Instance",
            description: "Represents a running container that is connected to the Nestri network..",
            example: Examples.Instance,
        });

    export type Info = z.infer<typeof Info>;
    export const create = fn(Info.omit())
}