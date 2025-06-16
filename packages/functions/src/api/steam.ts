import { z } from "zod";
import { Hono } from "hono";
import { Resource } from "sst";
import { describeRoute } from "hono-openapi";
import { User } from "@nestri/core/user/index";
import { Examples } from "@nestri/core/examples";
import { Steam } from "@nestri/core/steam/index";
import { getCookie, setCookie } from "hono/cookie";
import { Client } from "@nestri/core/client/index";
import { ErrorCodes, VisibleError } from "@nestri/core/error";
import { ErrorResponses, validator, Result, notPublic } from "./utils";

export namespace SteamApi {
    export const route = new Hono()
        .get("/",
            describeRoute({
                tags: ["Steam"],
                summary: "List Steam accounts",
                description: "List all Steam accounts belonging to this user",
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(
                                    Steam.Info.array().openapi({
                                        description: "All linked Steam accounts",
                                        example: [Examples.SteamAccount]
                                    })
                                ),
                            },
                        },
                        description: "Linked Steam accounts details"
                    },
                    400: ErrorResponses[400],
                    429: ErrorResponses[429],
                }
            }),
            notPublic,
            async (c) =>
                c.json({
                    data: await Steam.list()
                })
        )
        .get("/callback/:id",
            validator(
                "param",
                z.object({
                    id: z.string().openapi({
                        description: "ID of the user to login",
                        example: Examples.User.id,
                    }),
                }),
            ),
            async (c) => {
                const cookieID = getCookie(c, "user_id");

                const userID = c.req.valid("param").id;

                if (!cookieID || cookieID !== userID) {
                    throw new VisibleError(
                        "authentication",
                        ErrorCodes.Authentication.UNAUTHORIZED,
                        "You should not be here"
                    );
                }

                const currentUser = await User.fromID(userID);
                if (!currentUser) {
                    throw new VisibleError(
                        "not_found",
                        ErrorCodes.NotFound.RESOURCE_NOT_FOUND,
                        `User ${userID} not found`
                    )
                }

                const params = new URL(c.req.url).searchParams;

                // Verify OpenID response and get steamID
                const steamID = await Client.verifyOpenIDResponse(params);

                // If verification failed, return error
                if (!steamID) {
                    throw new VisibleError(
                        "authentication",
                        ErrorCodes.Authentication.UNAUTHORIZED,
                        "Invalid OpenID authentication response"
                    );
                }

                const user = (await Client.getUserInfo([steamID]))[0];

                if (!user) {
                    throw new VisibleError(
                        "internal",
                        ErrorCodes.NotFound.RESOURCE_NOT_FOUND,
                        "Steam user data is missing"
                    );
                }

                const wasAdded = await Steam.create({ ...user, userID });

                if (!wasAdded) {
                    // Update the owner of the Steam account
                    await Steam.updateOwner({ userID, steamID })
                }

                return c.html(
                    `
                    <script>
                       window.location.href = "about:blank";
                       window.close()
                    </script>
                    `
                )
            }
        )
        .get("/popup/:id",
            describeRoute({
                tags: ["Steam"],
                summary: "Login to Steam",
                description: "Login to Steam in a popup",
                responses: {
                    400: ErrorResponses[400],
                    429: ErrorResponses[429],
                }
            }),
            validator(
                "param",
                z.object({
                    id: z.string().openapi({
                        description: "ID of the user to login",
                        example: Examples.User.id,
                    }),
                }),
            ),
            async (c) => {
                const userID = c.req.valid("param").id;

                const user = await User.fromID(userID);
                if (!user) {
                    throw new VisibleError(
                        "not_found",
                        ErrorCodes.NotFound.RESOURCE_NOT_FOUND,
                        `User ${userID} not found`
                    )
                }

                setCookie(c, "user_id", user.id);

                const returnUrl = `${new URL(Resource.Urls.api).origin}/steam/callback/${userID}`

                const params = new URLSearchParams({
                    'openid.ns': 'http://specs.openid.net/auth/2.0',
                    'openid.mode': 'checkid_setup',
                    'openid.return_to': returnUrl,
                    'openid.realm': new URL(returnUrl).origin,
                    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
                    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
                    'user_id': user.id
                });

                return c.redirect(`https://steamcommunity.com/openid/login?${params.toString()}`, 302)
            }
        )
}