import { z } from "zod";
import { Hono } from "hono";
import { Resource } from "sst";
import { bus } from "sst/aws/bus";
import { Actor } from "@nestri/core/actor";
import { describeRoute } from "hono-openapi";
import { User } from "@nestri/core/user/index";
import { Examples } from "@nestri/core/examples";
import { Steam } from "@nestri/core/steam/index";
import { getCookie, setCookie } from "hono/cookie";
import { Client } from "@nestri/core/client/index";
import { Friend } from "@nestri/core/friend/index";
import { Library } from "@nestri/core/library/index";
import { chunkArray } from "@nestri/core/utils/helper";
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

                c.executionCtx.waitUntil((async () => {
                    try {
                        // Get friends info
                        const friends = await Client.getFriendsList(steamID);

                        const friendSteamIDs = friends.friendslist.friends.map(f => f.steamid);

                        // Steam API has a limit of requesting 100 friends at a go
                        const friendChunks = chunkArray(friendSteamIDs, 100);

                        const settled = await Promise.allSettled(
                            friendChunks.map(async (friendIDs) => {
                                const friendsInfo = await Client.getUserInfo(friendIDs)

                                return await Promise.all(
                                    friendsInfo.map(async (friend) => {
                                        const wasAdded = await Steam.create(friend);

                                        if (!wasAdded) {
                                            console.log(`Friend ${friend.id} already exists`)
                                        }

                                        await Friend.add({ friendSteamID: friend.id, steamID })

                                        return friend.id
                                    })
                                )
                            })
                        )

                        settled
                            .filter(result => result.status === 'rejected')
                            .forEach(result => console.warn('[putFriends] failed:', (result as PromiseRejectedResult).reason))

                        const prod = (Resource.App.stage === "production" || Resource.App.stage === "dev")

                        const friendIDs = [
                            steamID,
                            ...(prod ? settled
                                .filter(result => result.status === "fulfilled")
                                .map(f => f.value)
                                .flat() : [])
                        ]

                        await Promise.all(
                            friendIDs.map(async (currentSteamID) => {
                                // Get user library
                                const gameLibrary = await Client.getUserLibrary(currentSteamID);

                                const queryLib = await Promise.allSettled(
                                    gameLibrary.response.games.map(async (game) => {
                                        await Actor.provide(
                                            "steam",
                                            {
                                                steamID: currentSteamID,
                                            },
                                            async () => {

                                               await bus.publish(
                                                    Resource.Bus,
                                                    Library.Events.Add,
                                                    {
                                                        appID: game.appid,
                                                        totalPlaytime: game.playtime_forever,
                                                        lastPlayed: game.rtime_last_played ? new Date(game.rtime_last_played * 1000) : null,
                                                    }
                                                )

                                            }
                                        )
                                    })
                                )

                                queryLib
                                    .filter(i => i.status === "rejected")
                                    .forEach(e => console.warn(`[pushUserLib]: Failed to push user library to queue: ${e.reason}`))
                            })
                        )
                    } catch (error: any) {
                        console.error(`Failed to process Steam data for user ${userID}:`, error);
                    }
                })())

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

                const returnUrl = `${new URL(c.req.url).origin}/steam/callback/${userID}`

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