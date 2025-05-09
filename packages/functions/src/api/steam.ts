import { z } from "zod";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { Actor } from "@nestri/core/actor";
import SteamCommunity from "steamcommunity";
import { describeRoute } from "hono-openapi";
import { Steam } from "@nestri/core/steam/index";
import { Team } from "@nestri/core/team/index";
import { Examples } from "@nestri/core/examples";
import { Member } from "@nestri/core/member/index";
import { ErrorResponses, validator, Result } from "./utils";
import { Credentials } from "@nestri/core/credentials/index";
import { LoginSession, EAuthTokenPlatformType } from "steam-session";
import type CSteamUser from "steamcommunity/classes/CSteamUser";

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
        .get("/login",
            describeRoute({
                tags: ["Steam"],
                summary: "Login to Steam using QR code",
                description: "Login to Steam using a QR code sent using Server Sent Events",
                responses: {
                    400: ErrorResponses[400],
                    429: ErrorResponses[429],
                }
            }),
            validator(
                "header",
                z.object({
                    "accept": z.string()
                        .refine((v) =>
                            v.toLowerCase()
                                .includes("text/event-stream")
                        )
                        .openapi({
                            description: "Client must accept Server Sent Events",
                            example: "text/event-stream"
                        })
                })
            ),
            (c) => {
                const currentUser = Actor.user()

                return streamSSE(c, async (stream) => {

                    const session = new LoginSession(EAuthTokenPlatformType.MobileApp);

                    session.loginTimeout = 30000; //30 seconds is typically when the url expires

                    await stream.writeSSE({
                        event: 'status',
                        data: JSON.stringify({ message: "connected to steam" })
                    })

                    const challenge = await session.startWithQR();

                    await stream.writeSSE({
                        event: 'challenge_url',
                        data: JSON.stringify({ url: challenge.qrChallengeUrl })
                    })

                    return new Promise((resolve, reject) => {
                        session.on('remoteInteraction', async () => {
                            await stream.writeSSE({
                                event: 'remote_interaction',
                                data: JSON.stringify({ message: "Looks like you've scanned the code! Now just approve the login." }),
                            })

                            await stream.writeSSE({
                                event: 'status',
                                data: JSON.stringify({ message: "Looks like you've scanned the code! Now just approve the login." }),
                            })
                        });

                        session.on('timeout', async () => {
                            console.log('This login attempt has timed out.');

                            await stream.writeSSE({
                                event: 'status',
                                data: JSON.stringify({ message: "Your session timed out" }),
                            })

                            await stream.writeSSE({
                                event: 'timed_out',
                                data: JSON.stringify({ success: false }),
                            })

                            await stream.close()
                            reject("Authentication timed out")
                        });

                        session.on('error', async (err) => {
                            // This should ordinarily not happen. This only happens in case there's some kind of unexpected error while
                            // polling, e.g. the network connection goes down or Steam chokes on something.
                            await stream.writeSSE({
                                event: 'status',
                                data: JSON.stringify({ message: "Recieved an error while authenticating" }),
                            })

                            await stream.writeSSE({
                                event: 'error',
                                data: JSON.stringify({ message: err.message }),
                            })

                            await stream.close()
                            reject(err.message)
                        });


                        session.on('authenticated', async () => {
                            await stream.writeSSE({
                                event: 'status',
                                data: JSON.stringify({ message: "Login successful" })
                            })

                            await stream.writeSSE({
                                event: 'login_success',
                                data: JSON.stringify({ success: true, })
                            })

                            const username = session.accountName;
                            const accessToken = session.accessToken;
                            const refreshToken = session.refreshToken;
                            const steamID = session.steamID.toString();
                            const cookies = await session.getWebCookies();

                            // Get user information
                            const community = new SteamCommunity();
                            community.setCookies(cookies);

                            const user = await new Promise((res, rej) => {
                                community.getSteamUser(session.steamID, async (error, user) => {
                                    if (!error) {
                                        res(user)
                                    } else {
                                        rej(error)
                                    }
                                })
                            }) as CSteamUser

                            const wasAdded =
                                await Steam.create({
                                    username,
                                    id: steamID,
                                    name: user.name,
                                    realName: user.realName,
                                    userID: currentUser.userID,
                                    avatarHash: user.avatarHash,
                                    steamMemberSince: user.memberSince,
                                    profileUrl: user.customURL?.trim() || null,
                                    limitations: {
                                        isLimited: user.isLimitedAccount,
                                        isVacBanned: user.vacBanned,
                                        privacyState: user.privacyState as any,
                                        visibilityState: Number(user.visibilityState),
                                        tradeBanState: user.tradeBanState.toLowerCase() as any,
                                    }
                                })

                            // Does not matter if the user is already there or has just been created, just store the credentials
                            await Credentials.create({ refreshToken, id: steamID, username })

                            if (!!wasAdded) {
                                // create a team
                                const teamID = await Team.create({
                                    slug: username,
                                    name: `${user.name.split(" ")[0]}'s Team`,
                                    ownerID: currentUser.userID,
                                })

                                await Actor.provide(
                                    "system",
                                    { teamID },
                                    async () => {
                                        await Member.create({
                                            role: "adult",
                                            userID: currentUser.userID,
                                            steamID
                                        })
                                    })
                            }

                            await stream.writeSSE({
                                event: 'team_slug',
                                data: JSON.stringify({ username })
                            })

                            //TODO: Get game library

                            await stream.close()

                            resolve()
                        })

                    })
                })
            }
        )
}