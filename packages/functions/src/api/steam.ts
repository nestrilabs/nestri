import { Hono } from "hono";
import { ErrorResponses, Result } from "./common";
import { Steam } from "@nestri/core/steam/index";
import { describeRoute } from "hono-openapi";
import { Examples } from "@nestri/core/examples";
import { assertActor } from "@nestri/core/actor";
import { ErrorCodes, VisibleError } from "@nestri/core/error";

export namespace SteamApi {
    export const route = new Hono()
        .get("/",
            describeRoute({
                tags: ["Steam"],
                summary: "Get Steam account information",
                description: "Get the user's Steam account information",
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(
                                    Steam.Info.openapi({
                                        description: "The Steam account information",
                                        example: Examples.Steam,
                                    }),
                                ),
                            },
                        },
                        description: "Successfully got the Steam account information",
                    },
                    404: ErrorResponses[404],
                    429: ErrorResponses[429],
                }
            }),
            async (c) => {
                const actor = assertActor("user");
                const steamInfo = await Steam.fromUserID(actor.properties.userID);
                if (!steamInfo)
                    throw new VisibleError(
                        "not_found",
                        ErrorCodes.NotFound.RESOURCE_NOT_FOUND,
                        "Steam account information not found",
                    );

                return c.json({ data: steamInfo }, 200);
            }
        )
}