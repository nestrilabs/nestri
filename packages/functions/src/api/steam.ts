import { z } from "zod";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { Actor } from "@nestri/core/actor";
import SteamCommunity from "steamcommunity";
import { describeRoute } from "hono-openapi";
import { Steam } from "@nestri/core/steam/index";
import { ErrorResponses, validator } from "./utils";
import { Credentials } from "@nestri/core/credentials/index";
import { LoginSession, EAuthTokenPlatformType } from "steam-session";

export namespace SteamApi {
    export const route = new Hono()
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
                        .toLowerCase()
                        .includes("text/event-stream")
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

                            const username = session.accountName;
                            const accessToken = session.accessToken;
                            const refreshToken = session.refreshToken;
                            const steamID = session.steamID.toString();
                            const cookies = await session.getWebCookies();

                            await Credentials.create({ refreshToken, id: steamID, username })

                            // Get user information
                            const community = new SteamCommunity()
                            community.setCookies(cookies);

                            community.getSteamUser(session.steamID, async (error, user) => {
                                if (!error) {
                                    const wasAdded =
                                        await Steam.create({
                                            username,
                                            id: steamID,
                                            name: user.name,
                                            realName: user.realName,
                                            userID: currentUser.userID,
                                            avatarHash: user.avatarHash,
                                            steamMemberSince: user.memberSince,
                                            profileUrl: user.customURL !== "" ? user.customURL : null,
                                            limitations: {
                                                isLimited: user.isLimitedAccount,
                                                isVacBanned: user.vacBanned,
                                                privacyState: user.privacyState as any,
                                                visibilityState: Number(user.visibilityState),
                                                tradeBanState: user.tradeBanState.toLowerCase() as any,
                                            }
                                        })
                                    if (!wasAdded) {
                                        console.log(`steam user ${steamID.toString()} already exists`)
                                    }

                                    await stream.writeSSE({
                                        event: 'team_slug',
                                        data: JSON.stringify({ username })
                                    })
                                }
                            });

                            //TODO: Get game library


                            await stream.writeSSE({
                                event: 'login_success',
                                data: JSON.stringify({ success: true, })
                            })

                            await stream.close()

                            resolve()
                        })

                    })
                })
            }
        )
}