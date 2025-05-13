import { z } from "zod";
import { ulid } from "ulid";
import { Hono } from "hono";
import { Resource } from "sst";
import { streamSSE } from "hono/streaming";
import { Actor } from "@nestri/core/actor";
import SteamCommunity from "steamcommunity";
import { describeRoute } from "hono-openapi";
import { Steam } from "@nestri/core/steam/index";
import { Team } from "@nestri/core/team/index";
import { Examples } from "@nestri/core/examples";
import { Member } from "@nestri/core/member/index";
import { Client } from "@nestri/core/client/index";
import { Library } from "@nestri/core/library/index";
import { chunkArray } from "@nestri/core/utils/helper";
import { ErrorResponses, validator, Result } from "./utils";
import { Credentials } from "@nestri/core/credentials/index";
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

                            const user = await Client.getUserInfo({ id: steamID, cookies })

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
                                const rawFirst = (user.name ?? username).trim().split(/\s+/)[0] ?? username;

                                const firstName = rawFirst
                                    .charAt(0) // first character
                                    .toUpperCase() // make it uppercase
                                    + rawFirst
                                        .slice(1) // rest of the string
                                        .toLowerCase();

                                // create a team
                                const teamID = await Team.create({
                                    slug: username,
                                    name: firstName,
                                    ownerID: currentUser.userID,
                                })

                                // Add us as the member
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

                            } else {
                                await Steam.updateOwner({ userID: currentUser.userID, steamID })
                            }

                            await stream.writeSSE({
                                event: 'team_slug',
                                data: JSON.stringify({ username })
                            })

                            // Get game library
                            const games = await Client.getUserLibrary(accessToken);

                            // Get a batch of 5 games each
                            const chunkedGames = chunkArray(games.response.apps, 5)

                            const team = await Team.fromSlug(username)

                            // Get the batches to the queue
                            const processQueue = chunkedGames.map(async (chunk) => {
                                const myGames = chunk.map(i => {
                                    return {
                                        appID: i.appid,
                                        totalPlaytime: i.rt_playtime,
                                        isFamilyShareable: i.exclude_reason === 0,
                                        // ownedByUs: i.owner_steamids.includes(steamID),
                                        lastPlayed: new Date(i.rt_last_played * 1000),
                                        timeAcquired: new Date(i.rt_time_acquired * 1000),
                                        isFamilyShared: !i.owner_steamids.includes(steamID) && i.exclude_reason === 0,
                                    }
                                })

                                if (team) {
                                    await Actor.provide(
                                        "member",
                                        {
                                            steamID,
                                            teamID: team.id,
                                            userID: currentUser.userID
                                        },
                                        async () => {
                                            const payload = Library.Events.Queue.create(myGames);

                                            await sqs.send(
                                                new SendMessageCommand({
                                                    MessageGroupId: team.id,
                                                    QueueUrl: Resource.LibraryQueue.url,
                                                    MessageBody: JSON.stringify(payload),
                                                    MessageDeduplicationId: ["queue", ulid()].join("_"),
                                                })
                                            )
                                        }
                                    )
                                }
                            })

                            const settled = await Promise.allSettled(processQueue)

                            settled
                                .filter(r => r.status === "rejected")
                                .forEach(r =>
                                    console.error("[LibraryQueue] enqueue failed:", (r as PromiseRejectedResult).reason),
                                );

                            await stream.close();

                            resolve();
                        })

                    })
                })
            }
        )
}