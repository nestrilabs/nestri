import { z } from "zod"
import { Hono } from "hono";
import { Steam } from "./steamAuth"
import { notPublic } from "../auth";
import { streamSSE } from "hono/streaming";
import { describeRoute } from "hono-openapi";
import path from "node:path"
// import { ErrorResponses, Result } from "./common";

export module SteamApi {
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
                const sessionID = crypto.randomUUID();

                return streamSSE(c, async (stream) => {

                    // Initialize Steam auth
                    const steam = new Steam(path.join(__dirname, "/bin/steam"));

                    await stream.writeSSE({
                        event: 'connected',
                        data: JSON.stringify({
                            sessionID
                        })
                    });

                    // Track URLs we've already sent to avoid duplicates if needed
                    const sentUrls = new Set();

                    // Listen for challenge URL - this will now catch ALL URL updates
                    steam.on('challengeUrl', async (url) => {
                        // Optional: Check if we've already sent this exact URL to avoid duplicate events
                        // Remove this check if you want to send every event even if URL is the same
                        if (!sentUrls.has(url)) {
                            sentUrls.add(url);
                            console.log("Sending challenge URL to client:", url);
                            await stream.writeSSE({
                                event: 'challenge',
                                data: JSON.stringify({ url, sessionID })
                            });
                        }
                    });

                    steam.on('error', async (error) => {
                        await stream.writeSSE({
                            event: 'error',
                            data: JSON.stringify({ message: error.message || 'Authentication error' })
                        });
                    });

                    // Listen for completion
                    steam.on('completed', async (result) => {
                        await stream.writeSSE({
                            event: 'complete',
                            data: JSON.stringify({ sessionID })
                        });
                        isCompleted = true;
                        await stream.close();
                    });

                    // Handle client disconnect
                    stream.onAbort(() => {
                        console.log('Client disconnected, cancelling Steam auth');
                        steam.cancel();
                    });

                    // Listen for credentials
                    steam.on('credentials', (credentials) => {
                        console.log("steam credentials received:", credentials);
                        // Don't send credentials directly to client for security reasons
                    });

                    try {
                        await steam.startAuth();

                        // Create a promise that only resolves when authentication completes or errors
                        await new Promise<void>((resolve) => {
                            // Already registered these events earlier, just need to add resolve() to them
                            steam.once('completed', () => resolve());
                            steam.once('error', () => resolve());

                            // Set timeout
                            setTimeout(() => {
                                if (!isCompleted) {
                                    stream.writeSSE({
                                        event: 'error',
                                        data: JSON.stringify({
                                            message: 'Authentication timed out'
                                        })
                                    });
                                    resolve();
                                }
                            }, 120000); // 2 minutes timeout
                        });
                    }
                    catch (error: any) {
                        console.error("error handling steam authentication");

                        await stream.writeSSE({
                            event: 'error',
                            data: JSON.stringify({ message: error.message || 'Authentication error' })
                        });
                    }

                    // Only close if not already closed
                    if (!isCompleted) {
                        await stream.close();
                    }

                })
            }
        )
}