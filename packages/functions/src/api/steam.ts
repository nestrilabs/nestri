import { z } from "zod";
import { Hono } from "hono";
import { notPublic } from "./auth";
import { streamSSE } from "hono/streaming";
import { Actor } from "@nestri/core/actor";
import { describeRoute } from "hono-openapi";
import { Steam } from "@nestri/core/steam/index";
import { Examples } from "@nestri/core/examples";
import { SteamClient } from "@nestri/core/steam/client";
import { ErrorResponses, validator, Result } from "./common";
import { EAuthTokenPlatformType, LoginSession } from 'steam-session';

export namespace SteamApi {
    export const route = new Hono()
        .use(notPublic)
        .get("/",
            describeRoute({
                tags: ["Steam"],
                summary: "Get the steam accounts",
                description: "Gets the Steam accounts for this user",
                responses: {
                    200: {
                        content: {
                            "application/json": {
                                schema: Result(
                                    Steam.Info.array().openapi({
                                        description: "All the steam accounts this user has",
                                        example: [Examples.SteamAccount]
                                    })
                                ),
                            },
                        },
                        description: "Steam accounts of this user"
                    },
                    400: ErrorResponses[400],
                    401: ErrorResponses[401],
                    404: ErrorResponses[404],
                    429: ErrorResponses[429],
                }
            }),
            async (c) => {
                const accounts = await Steam.list()
                return c.json({ data: accounts })
            }
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
                    "accept": z.string().includes("text/event-stream").openapi({
                        description: "Client must accept Server Sent Events",
                        example: "text/event-stream"
                    })
                })
            ),
            (c) => {
                const user = Actor.user()

                return streamSSE(c, async (stream) => {
                    const session = new LoginSession(
                        EAuthTokenPlatformType.SteamClient,
                        {
                            machineFriendlyName: "Nestri Cloud Gaming",
                        }
                    );
                    session.loginTimeout = 40000; //30 seconds is typically when the url expires

                    await stream.writeSSE({
                        event: 'status',
                        data: JSON.stringify({ message: "connected to steam" }),
                    })

                    const challenge_url = await session.startWithQR();

                    await stream.writeSSE({
                        event: 'challenge_url',
                        data: JSON.stringify({ url: challenge_url.qrChallengeUrl }),
                    })

                    await new Promise((resolve, reject) => {

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

                            reject("Authentication timed out")
                        });

                        session.on('error', async (err) => {
                            // This should ordinarily not happen. This only happens in case there's some kind of unexpected error while
                            // polling, e.g. the network connection goes down or Steam chokes on something.
                            console.log(`ERROR: This login attempt has failed! ${err.message}`);
                            await stream.writeSSE({
                                event: 'status',
                                data: JSON.stringify({ message: "Recieved an error while authenticating" }),
                            })

                            await stream.writeSSE({
                                event: 'error',
                                data: JSON.stringify({ message: err.message }),
                            })

                            reject(err.message)
                        });


                        session.on('authenticated', async () => {
                            await stream.writeSSE({
                                event: 'status',
                                data: JSON.stringify({ message: "Login successful" })
                            })

                            await stream.writeSSE({
                                event: 'login_success',
                                data: JSON.stringify({ success: true })
                            })

                            const username = session.accountName;
                            const accessToken = session.accessToken;
                            const refreshToken = session.refreshToken;
                            const steamID = session.steamID.getBigIntID();

                            await Steam.createCredential({ refreshToken, id: steamID, username })

                            const userData = await SteamClient.getUserData({ accessToken, steamIDs: [steamID] })

                            const userDB = userData.players.map(async (steamUser) => {
                                Actor.provide(
                                    "user",
                                    {
                                        userID: user.userID,
                                        email: user.email
                                    },
                                    async () => {
                                        //Attempt to create a new Steam user, if this fails (returns null) update the current user instead
                                        const id =
                                            await Steam.create({
                                                id: steamID,
                                                useUser: true,
                                                realName: steamUser.realname,
                                                avatarHash: steamUser.avatarhash,
                                                profileUrl: steamUser.profileurl,
                                                personaName: steamUser.personaname,
                                            })

                                        if (!id) {
                                            await Steam.update({
                                                id: steamID,
                                                useUser: true,
                                                realName: steamUser.realname,
                                                avatarHash: steamUser.avatarhash,
                                                profileUrl: steamUser.profileurl,
                                                personaName: steamUser.personaname,
                                            })
                                        }
                                    }
                                )
                            })

                            await Promise.allSettled(userDB)

                            await stream.close()

                            resolve("Done!")
                        })
                    })
                })
            })
}