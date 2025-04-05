import { z } from "zod"
import { Hono } from "hono";
import path from "node:path"
import { Steam } from "./steamAuth"
import { notPublic } from "../auth";
import { streamSSE } from "hono/streaming";
import { describeRoute } from "hono-openapi";
import { Steam as SteamDB } from "@nestri/core/steam/index"
// import { ErrorResponses, Result } from "./common";

export namespace SteamApi {
    export const route = new Hono()
        .use(notPublic)
        .get("/login",
            describeRoute({
                tags: ["Steam"],
                summary: "Login to Steam",
                description: "Login to Steam by scanning the SteamGuard QR Code on mobile",
                // responses: {
                //     200: {
                //         content: {
                //             "application/json": {
                //                 schema: Result(
                //                     z.literal("ok")
                //                 )
                //             }
                //         },
                //         description: "Steam client authenticated succesfully"
                //     },
                //     409: ErrorResponses[409],
                //     429: ErrorResponses[429],
                //     500: ErrorResponses[500],
                // }
            }),
            async (c) => {
                let isCompleted = false;
                let hasError = false;
                const sessionID = crypto.randomUUID();

                return streamSSE(c, async (stream) => {
                    // Initialize Steam auth
                    const steam = new Steam(path.join(__dirname, "/bin/steam"));

                    console.log("Starting Steam auth session:", sessionID);

                    await stream.writeSSE({
                        event: 'connected',
                        data: JSON.stringify({
                            sessionID
                        })
                    });

                    // Track URLs we've already sent to avoid duplicates if needed
                    const sentUrls = new Set();

                    // Listen for challenge URL
                    steam.on('challengeUrl', async (url) => {
                        try {
                            // Optional: Check if we've already sent this exact URL to avoid duplicate events
                            if (!sentUrls.has(url)) {
                                sentUrls.add(url);
                                console.log(`[${sessionID}] Sending challenge URL to client`);
                                await stream.writeSSE({
                                    event: 'challenge',
                                    data: JSON.stringify({ url, sessionID })
                                });
                            }
                        } catch (e) {
                            console.error(`[${sessionID}] Error sending challenge URL:`, e);
                        }
                    });

                    // Listen for errors and actually handle them
                    steam.on('error', async (error) => {
                        try {
                            hasError = true;
                            console.error(`[${sessionID}] Steam auth error:`, error);

                            await stream.writeSSE({
                                event: 'error',
                                data: JSON.stringify({
                                    message: error.message || 'Authentication error',
                                    sessionID
                                })
                            });
                        } catch (e) {
                            console.error(`[${sessionID}] Error sending error event:`, e);
                        }
                    });

                    // Listen for completion
                    steam.on('completed', async (result) => {

                    });

                    // Handle client disconnect
                    stream.onAbort(() => {
                        console.log(`[${sessionID}] Client disconnected, cancelling Steam auth`);
                        steam.cancel();
                    });

                    // Listen for credentials 
                    steam.on('credentials', async (credentials) => {
                        try {
                            console.log(`[${sessionID}] Steam credentials received!`);

                            // Store credentials in database (uncomment when ready)
                            // await SteamDB.create(credentials);

                            // Note: Don't call complete here - the 'completed' event will fire
                            // when the process is done, and we'll send the complete event then
                        } catch (e) {
                            console.error(`[${sessionID}] Error processing credentials:`, e);
                        }
                    });

                    try {
                        await steam.startAuth();

                        // Create a promise that resolves when authentication completes or times out
                        await new Promise<void>((resolve) => {
                            // Set timeout - longer than the internal Steam auth timeout
                            const timeout = setTimeout(() => {
                                if (!isCompleted) {
                                    console.log(`[${sessionID}] Auth timed out at API level`);
                                    stream.writeSSE({
                                        event: 'error',
                                        data: JSON.stringify({
                                            message: 'Authentication timed out',
                                            sessionID
                                        })
                                    }).finally(() => {
                                        resolve();
                                    });
                                }
                            }, 125000); // 2 minutes + 5s buffer

                            // Clean up the timeout when we're done
                            steam.once('completed', async(result) => {
                                try {
                                    console.log(`[${sessionID}] Auth completed with result:`, result);
                                    isCompleted = true;

                                    // Only send completion if we successfully got credentials
                                    if (result.credentials) {
                                        await stream.writeSSE({
                                            event: 'complete',
                                            data: JSON.stringify({
                                                success: true,
                                                sessionID
                                            })
                                        });
                                    } else if (!hasError) {
                                        // If we didn't get credentials and there wasn't already an error sent
                                        await stream.writeSSE({
                                            event: 'error',
                                            data: JSON.stringify({
                                                message: result.error || 'Authentication failed to obtain credentials',
                                                sessionID
                                            })
                                        });
                                    }

                                    // Give time for the event to be sent before closing
                                    setTimeout(async () => {
                                        await stream.close();
                                    }, 1000);
                                } catch (e) {
                                    console.error(`[${sessionID}] Error sending completion event:`, e);
                                    await stream.close();
                                }

                                clearTimeout(timeout);
                                resolve();
                            });
                        });
                    }
                    catch (error: any) {
                        console.error(`[${sessionID}] Fatal error in Steam auth:`, error);

                        try {
                            await stream.writeSSE({
                                event: 'error',
                                data: JSON.stringify({
                                    message: error.message || 'Fatal authentication error',
                                    sessionID
                                })
                            });
                        } catch (e) {
                            console.error(`[${sessionID}] Error sending fatal error event:`, e);
                        }

                        // Give time for the event to be sent before closing
                        setTimeout(async () => {
                            await stream.close();
                        }, 1000);
                    }
                })
            }
        )
}