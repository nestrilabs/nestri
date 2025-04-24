import { z } from "zod";
import { Hono } from "hono";
import { notPublic } from "./auth";
import { streamSSE } from "hono/streaming";
import { describeRoute } from "hono-openapi";
import { assertActor } from "@nestri/core/actor";
import { Steam } from "@nestri/core/steam/index";
import { Examples } from "@nestri/core/examples";
import { Friend } from "@nestri/core/friend/index";
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
                                // schema: Result(
                                //     Steam.BasicInfo.array().openapi({
                                //         description: "All the steam accounts this user has",
                                //         example: [Examples.Steam]
                                //     })
                                // ),
                            },
                        },
                        description: "Steam accounts of this user"
                    },
                    400: ErrorResponses[400],
                    404: ErrorResponses[404],
                    429: ErrorResponses[429],
                }
            }),
            async (c) => {
                assertActor("user")
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
                const user = assertActor("user")

                return streamSSE(c, async (stream) => {
                    const session = new LoginSession(
                        EAuthTokenPlatformType.SteamClient,
                        {
                            machineFriendlyName: "Nestri Cloud Gaming",
                        }
                    );
                    session.loginTimeout = 60000; //1 Minute is typically when the url expires

                    await stream.writeSSE({
                        event: 'status',
                        data: JSON.stringify({ message: "connected to steam" }),
                    })

                    const challenge_url = await session.startWithQR();

                    await stream.writeSSE({
                        event: 'challenge_url',
                        data: JSON.stringify({ url: challenge_url }),
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

                        session.on('authenticated', async () => {
                            await stream.writeSSE({
                                event: 'status',
                                data: JSON.stringify({ message: "Login succesful" }),
                            })

                            await stream.writeSSE({
                                event: 'login_success',
                                data: JSON.stringify({ success: true }),
                            })

                            const accessToken = session.accessToken;
                            const refreshToken = session.refreshToken;
                            const steamID = session.steamID.getBigIntID();
                            const username = session.accountName;
                            // We can also get web cookies now that we've negotiated a session
                            let cookies = await session.getWebCookies();
                            console.log("\n===============================\n")
                            console.log("WebCookies:")
                            console.log(cookies);
                            console.log("\n===============================\n")

                            console.log("\n===============================\n")
                            console.log("Access Token:")
                            console.log(accessToken);
                            console.log("\n===============================\n")

                            console.log("\n===============================\n")
                            console.log("Refresh Token:")
                            console.log(refreshToken);
                            console.log("\n===============================\n")

                            await Steam.createCredential({ refreshToken, steamID, username })

                            //FIXME: Add this to their respective routes instead of shoving them here -  for easier and scalable way to do this
                            c.executionCtx.waitUntil(
                                new Promise(async (resolve, reject) => {

                                    //Stage 1: Add the user and the friends
                                    const friends = await SteamClient.getFriends({ accessToken, steamIDs: [steamID] });

                                    const friendsSteamIDs = friends.friends.map(i => BigInt(i.steamid));

                                    //Get all friends data, max is 100 friends :D Woah!!!
                                    const userData = await SteamClient.getUserData({ accessToken, steamIDs: [steamID, ...friendsSteamIDs].slice(0, 100) })

                                    const userDB = userData.players.map(async (steamUser) => {
                                        // If we are the current user, do not add a friendship relation
                                        if (steamUser.steamid.toLowerCase().includes(steamID.toString().toLowerCase())) {
                                            await Steam.create({
                                                steamID,
                                                realName: steamUser.realname,
                                                userID: user.properties.userID,
                                                avatarHash: steamUser.avatarhash,
                                                profileUrl: steamUser.profileurl,
                                                personaName: steamUser.personaname,
                                            })
                                        } else {
                                            await Steam.create({
                                                steamID: BigInt(steamUser.steamid),
                                                realName: steamUser.realname,
                                                // userID: user.properties.userID,
                                                userID: null,
                                                avatarHash: steamUser.avatarhash,
                                                profileUrl: steamUser.profileurl,
                                                personaName: steamUser.personaname,
                                            })

                                            // Add this person as the owner's friend
                                            await Friend.add({
                                                steamID,
                                                friendSteamID: BigInt(steamUser.steamid)
                                            })
                                        }
                                    })

                                    await Promise.allSettled(userDB)

                                    // Stage 2: Add their games
                                    const ownedGameIDs = await SteamClient.getOwnedGamesCompatList({ cookies });

                                    const gameDB = ownedGameIDs.map(async (gameID) => {
                                        const gameInfo = await SteamClient.getGameInfo({ gameID, cookies })

                                        // const gameImages = 
                                    })

                                    await Promise.allSettled(gameDB)

                                    resolve("We are done! Hooray!")
                                })
                            )

                            await stream.close()

                            resolve("Success")
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
                    })
                })
            }
        )
}