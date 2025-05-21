import { z } from "zod";
import { Hono } from "hono";
import { Actor } from "@nestri/core/actor";
import { describeRoute } from "hono-openapi";
import { Team } from "@nestri/core/team/index";
import { User } from "@nestri/core/user/index";
import { Examples } from "@nestri/core/examples";
import { Steam } from "@nestri/core/steam/index";
import { getCookie, setCookie } from "hono/cookie";
import { Member } from "@nestri/core/member/index";
import { Client } from "@nestri/core/client/index";
import { Friend } from "@nestri/core/friend/index";
import { Library } from "@nestri/core/library/index";
import { chunkArray } from "@nestri/core/utils/helper";
import { ErrorCodes, VisibleError } from "@nestri/core/error";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { ErrorResponses, validator, Result, notPublic } from "./utils";

const sqs = new SQSClient({});

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

                let teamID: string | undefined

                if (wasAdded) {
                    // create a team
                    teamID = await Team.create({
                        name:  user.name,
                        ownerSteamID: steamID,
                    })

                    // Add us as a member
                    await Actor.provide(
                        "system",
                        { teamID },
                        async () =>
                            await Member.create({
                                role: "adult",
                                userID: userID,
                                steamID
                            })
                    )

                } else {
                    // Update the owner of the Steam account
                    await Steam.updateOwner({ userID, steamID })
                    await Actor.provide(
                        "user",
                        {
                            email: currentUser.email,
                            userID: currentUser.id
                        },
                        async () => {
                            // Get the team associated with this steamID
                            const team = await Team.fromSteamID(steamID);
                            // This should never happen
                            if (!team) throw Error(`Is Nestri okay???, we could not find the team with this steam_id ${steamID}`)

                            teamID = team.id
                        }
                    )
                }

                c.executionCtx.waitUntil((async () => {
                    // Get friends info
                    const friends = await Client.getFriendsList(steamID);

                    const friendSteamIDs = friends.friendslist.friends.map(f => f.steamid);

                    // Steam API has a limit of requesting 100 friends at a go
                    const friendChunks = chunkArray(friendSteamIDs, 100);

                    const settled = await Promise.allSettled(
                        friendChunks.map(async (friendIDs) => {
                            const friendsInfo = await Client.getUserInfo(friendIDs)

                            friendsInfo.map(async (friend) => {
                                const wasAdded = await Steam.create(friend);

                                if (!wasAdded) {
                                    console.log(`Friend ${friend.id} already exists`)
                                }

                                await Friend.add({ friendSteamID: friend.id, steamID })
                            })
                        })
                    )

                    settled
                        .filter(result => result.status === 'rejected')
                        .forEach(result => console.warn('[putFriends] failed:', (result as PromiseRejectedResult).reason))

                })())

                return c.json({ data: "ok" })
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