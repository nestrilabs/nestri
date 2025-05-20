import { z } from "zod";
import { Hono } from "hono";
import crypto from 'crypto';
import { Resource } from "sst";
import { Actor } from "@nestri/core/actor";
import SteamCommunity from "steamcommunity";
import { describeRoute } from "hono-openapi";
import { Team } from "@nestri/core/team/index";
import { Examples } from "@nestri/core/examples";
import { Steam } from "@nestri/core/steam/index";
import { Member } from "@nestri/core/member/index";
import { Client } from "@nestri/core/client/index";
import { Library } from "@nestri/core/library/index";
import { chunkArray } from "@nestri/core/utils/helper";
import { ErrorResponses, validator, Result, notPublic } from "./utils";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { LoginSession, EAuthTokenPlatformType } from "steam-session";

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
            async (c) =>
                c.json({
                    data: await Steam.list()
                })
        )
        .get("/callback",
            async (c) => {
                const params = new URL(c.req.url).searchParams;

                //TODO: Do it here
                const steamID = params.get('openid.claimed_id')?.split('/').pop();

                // const userInfo = await Client.getUserInfo([steamID!])

                const friends = await Client.getFriendsList(steamID!);

                const friendSteamIDs = friends.friendslist.friends.map(f => f.steamid)

                const friendsInfo = await Client.getUserInfo(friendSteamIDs)

                // FIXME: Continue from here; have a way to add this to the db
                return c.json(friendsInfo)
            }
        )
        .get("/popup",
            describeRoute({
                tags: ["Steam"],
                summary: "Login to Steam",
                description: "Login to Steam in a popup",
                responses: {
                    400: ErrorResponses[400],
                    429: ErrorResponses[429],
                }
            }),
            (c) => {
                const returnUrl = `${new URL(c.req.url).origin}/steam/callback`

                const params = new URLSearchParams({
                    'openid.ns': 'http://specs.openid.net/auth/2.0',
                    'openid.mode': 'checkid_setup',
                    'openid.return_to': returnUrl,
                    'openid.realm': new URL(returnUrl).origin,
                    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
                    'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select'
                });

                return c.redirect(`https://steamcommunity.com/openid/login?${params.toString()}`, 308)
            }
        )
}