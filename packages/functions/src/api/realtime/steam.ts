import { Resource } from "sst";
import { subjects } from "../../subjects";
import { Steam } from "@nestri/core/steam/index";
import { ActionContext, actor, UserError } from "actor-core";
import { createClient } from "@openauthjs/openauth/client";
import { SteamAuthClient, SteamAuthEvent } from "@nestri/steam";

// Authentication client
const client = createClient({
    clientID: "realtime",
    issuer: Resource.Auth.url
});

// Constants for retry/timeout
const MAX_AUTH_TIMEOUT = 300000; // 5 minutes
const HEALTH_CHECK_INTERVAL = 10000; // 10 seconds

export const steam = actor({
    // state: {
    //     timeoutId: null as NodeJS.Timeout | null,
    //     healthCheckInterval: null as NodeJS.Timeout | null,
    // },
    async createConnState(_c, { params }: { params: { authToken: string } }) {
        // Validate auth token
        if (!params.authToken) {
            throw new UserError("No auth token provided", {
                code: "auth_token_missing",
            });
        }

        // Verify token
        const result = await client.verify(subjects, params.authToken);

        if (result.err) {
            throw new UserError("Invalid auth token", {
                code: "auth_token_invalid",
            });
        }

        if (result.subject.type !== "user") {
            throw new UserError("Unauthorized entity", {
                code: "unauthorized_entity",
            });
        }

        return {
            userID: result.subject.properties.userID,
            email: result.subject.properties.email,
            timeoutId: null,
            healthCheckInterval: null
        };
    },

    actions: {
        // Start login process
        login: async (c) => {
            let globalTimeoutId = null as NodeJS.Timeout | null;
            let globalHealthCheckInterval = null as NodeJS.Timeout | null;

            try {
                const steam = new SteamAuthClient();

                // Check if Steam server is healthy
                const healthy = await steam.checkHealth();
                if (!healthy) {
                    throw new UserError("Steam authentication server is not available", {
                        code: "steam_server_unavailable",
                    });
                }

                // Send status update
                c.conn.send("status_update", { message: "Connecting to Steam..." });

                // Set up event listeners
                steam.on(SteamAuthEvent.CHALLENGE_URL, (url: string) => {
                    c.conn.send("challenge_url", { url });

                    // Set timeout for QR code auth
                    const timeoutId = setTimeout(() => {
                        c.conn.send("login_error", {
                            message: "Authentication timed out. Please try again."
                        });
                        // Clean up resources
                        cleanupSession(globalTimeoutId, globalHealthCheckInterval, steam);
                    }, MAX_AUTH_TIMEOUT);

                    // Store timeout reference
                    // if (c.state.activeSessions.has(sessionID)) {
                    globalTimeoutId = timeoutId;
                    // }
                });

                steam.on(SteamAuthEvent.STATUS_UPDATE, (status: any) => {
                    c.conn.send("status_update", {
                        message: status.message || "Waiting for authentication..."
                    });
                });

                steam.on(SteamAuthEvent.LOGIN_ERROR, (error: any) => {
                    c.conn.send("login_error", {
                        message: error.message || "Steam authentication failed"
                    });
                    cleanupSession(globalTimeoutId, globalHealthCheckInterval, steam);
                });

                steam.on(SteamAuthEvent.ERROR, (error: any) => {
                    c.conn.send("error", {
                        error: error.error || "An unknown error occurred"
                    });
                    cleanupSession(globalTimeoutId, globalHealthCheckInterval, steam);
                });

                steam.on(SteamAuthEvent.CREDENTIALS, async (creds: { refreshToken: string; username: string; }) => {
                    try {
                        // Store credentials
                        await Steam.createCredential({
                            accessToken: creds.refreshToken,
                            username: creds.username
                        });

                        // Notify client of success
                        c.conn.send("login_success", {
                            message: "Steam authentication successful",
                            steamId: creds.username
                        });

                    } catch (error) {
                        console.error("Failed to store Steam credentials:", error);
                        c.conn.send("login_error", {
                            message: "Failed to save Steam credentials"
                        });
                    } finally {
                        // Clean up resources
                        cleanupSession(globalTimeoutId, globalHealthCheckInterval, steam);
                    }
                });

                // Start periodic health check
                const healthCheckInterval = setInterval(async () => {
                    try {
                        const isHealthy = await steam.checkHealth();
                        if (!isHealthy) {
                            c.conn.send("error", {
                                error: "Lost connection to Steam server"
                            });
                            clearInterval(healthCheckInterval);
                            cleanupSession(globalTimeoutId, globalHealthCheckInterval, steam);
                        }
                    } catch (e) {
                        // Health check itself failed
                        clearInterval(healthCheckInterval);
                    }
                }, HEALTH_CHECK_INTERVAL);

                // Store health check interval for cleanup
                // if (!c.state.healthCheckInterval) {
                globalHealthCheckInterval = healthCheckInterval;
                // }

                // Start QR login flow
                await steam.startQRLogin();

            } catch (error) {
                console.error("Steam login error:", error);
                c.conn.send("login_error", {
                    message: error instanceof Error ? error.message : "Failed to start Steam authentication"
                });
            }
        },

        // Check if user has Steam credentials
        // checkSteamCredentials: async (c) => {
        //     try {
        //         const credentials = await Steam.getCredentials(c.state.userID);
        //         return {
        //             hasCredentials: !!credentials,
        //             username: credentials?.username || null
        //         };
        //     } catch (error) {
        //         console.error("Failed to check Steam credentials:", error);
        //         return { hasCredentials: false };
        //     }
        // },

        // Manual cancel/cleanup
        cancelLogin: async (c) => {
            // cleanupSession(c);
            return { success: true };
        }
    },

    // onDisconnect(c) {
    //     //Remove timeoutId if exists
    //     if (c.state.timeoutId) {
    //         clearTimeout(c.state.timeoutId);
    //     }

    //     // Clear health check interval if exists
    //     if (c.state.healthCheckInterval) {
    //         clearInterval(c.state.healthCheckInterval);
    //     }
    // },
});

// Helper function to clean up session resources
function cleanupSession(
    timeoutId: null | NodeJS.Timeout,
    healthCheckInterval: null | NodeJS.Timeout,
    steam?: SteamAuthClient
) {

    // Clear timeout if exists
    if (timeoutId) {
        clearTimeout(timeoutId);
    }

    // Clear health check interval if exists
    if (healthCheckInterval) {
        clearInterval(healthCheckInterval);
    }

    // Clean up Steam client
    if (steam) {
        steam.destroy();
    }
}