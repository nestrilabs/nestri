import { z } from "zod";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { describeRoute } from "hono-openapi";
import { assertActor } from "@nestri/core/actor";
import { Result, ErrorResponses, validator } from "./common";
import { EAuthTokenPlatformType, LoginSession } from 'steam-session';
import { resolve } from "bun";

export namespace SteamApi {
    export const route = new Hono()
        .get("/",
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
                    session.loginTimeout = 120000;

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

                            // We can also get web cookies now that we've negotiated a session
                            let webCookies = await session.getWebCookies();
                            console.log('Web session cookies:');
                            console.log(webCookies);

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