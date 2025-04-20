// steam-auth-client.ts
import { request as httpRequest } from 'node:http';
import { connect as netConnect } from 'node:net';
import { Socket } from 'node:net';

/**
 * Event types emitted by the SteamAuthClient
 */
export enum SteamAuthEvent {
    CHALLENGE_URL = 'challenge_url',
    STATUS_UPDATE = 'status_update',
    CREDENTIALS = 'credentials',
    LOGIN_SUCCESS = 'login_success',
    LOGIN_ERROR = 'login_error',
    ERROR = 'error'
}

/**
 * Interface for Steam credentials
 */
export interface SteamCredentials {
    username: string;
    refreshToken: string;
}

/**
 * Options for SteamAuthClient constructor
 */
export interface SteamAuthClientOptions {
    socketPath?: string;
}

/**
 * SteamAuthClient provides methods to authenticate with Steam
 * through a C# service over Unix sockets.
 */
export class SteamAuthClient {
    private socketPath: string;
    private activeSocket: Socket | null = null;
    private eventListeners: Map<SteamAuthEvent, Function[]> = new Map();

    /**
     * Creates a new Steam authentication client
     * 
     * @param options Configuration options
     */
    constructor(options: SteamAuthClientOptions = {}) {
        this.socketPath = options.socketPath || '/tmp/steam.sock';
    }

    /**
     * Checks if the Steam service is healthy
     * 
     * @returns Promise resolving to true if service is healthy
     */
    async checkHealth(): Promise<boolean> {
        try {
            await this.makeRequest({ method: 'GET', path: '/' });
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Starts the QR code login flow
     * 
     * @returns Promise that resolves when login completes (success or failure)
     */
    startQRLogin(): Promise<void> {
        return new Promise<void>((resolve) => {
            // Create Socket connection for SSE
            this.activeSocket = netConnect({ path: this.socketPath });

            // Build the HTTP request manually for SSE
            const request =
                'GET /api/steam/login HTTP/1.1\r\n' +
                'Host: localhost\r\n' +
                'Accept: text/event-stream\r\n' +
                'Cache-Control: no-cache\r\n' +
                'Connection: keep-alive\r\n\r\n';

            this.activeSocket.on('connect', () => {
                this.activeSocket?.write(request);
            });

            this.activeSocket.on('error', (error) => {
                this.emit(SteamAuthEvent.ERROR, { error: error.message });
                resolve();
            });

            // Simple parser for SSE events over raw socket
            let buffer = '';
            let eventType = '';
            let eventData = '';

            this.activeSocket.on('data', (data) => {
                const chunk = data.toString();
                buffer += chunk;

                // Skip HTTP headers if present
                if (buffer.includes('\r\n\r\n')) {
                    const headerEnd = buffer.indexOf('\r\n\r\n');
                    buffer = buffer.substring(headerEnd + 4);
                }

                // Process each complete event
                const lines = buffer.split('\n');
                buffer = lines.pop() || ''; // Keep the last incomplete line in buffer

                for (const line of lines) {
                    if (line.startsWith('event: ')) {
                        eventType = line.substring(7);
                    } else if (line.startsWith('data: ')) {
                        eventData = line.substring(6);

                        // Complete event received
                        if (eventType && eventData) {
                            try {
                                const parsedData = JSON.parse(eventData);

                                // Handle specific events
                                if (eventType === 'challenge_url') {
                                    this.emit(SteamAuthEvent.CHALLENGE_URL, parsedData.url);
                                } else if (eventType === 'credentials') {
                                    this.emit(SteamAuthEvent.CREDENTIALS, {
                                        username: parsedData.username,
                                        refreshToken: parsedData.refreshToken
                                    });
                                } else if (eventType === 'login-success') {
                                    this.emit(SteamAuthEvent.LOGIN_SUCCESS, { steamId: parsedData.steamId });
                                    this.closeSocket();
                                    resolve();
                                } else if (eventType === 'status') {
                                    this.emit(SteamAuthEvent.STATUS_UPDATE, parsedData);
                                } else if (eventType === 'error' || eventType === 'login-unsuccessful') {
                                    this.emit(SteamAuthEvent.LOGIN_ERROR, {
                                        message: parsedData.message || parsedData.error
                                    });
                                    this.closeSocket();
                                    resolve();
                                } else {
                                    // Emit any other events as is
                                    this.emit(eventType as any, parsedData);
                                }
                            } catch (e) {
                                this.emit(SteamAuthEvent.ERROR, {
                                    error: `Error parsing event data: ${e}`
                                });
                            }

                            // Reset for next event
                            eventType = '';
                            eventData = '';
                        }
                    }
                }
            });
        });
    }

    /**
     * Logs in with existing credentials
     * 
     * @param credentials Steam credentials
     * @returns Promise resolving to login result
     */
    async loginWithCredentials(credentials: SteamCredentials): Promise<{
        success: boolean,
        steamId?: string,
        errorMessage?: string
    }> {
        try {
            const response = await this.makeRequest({
                method: 'POST',
                path: '/api/steam/login-with-credentials',
                body: credentials
            });

            if (response.success) {
                return {
                    success: true,
                    steamId: response.steamId
                };
            } else {
                return {
                    success: false,
                    errorMessage: response.errorMessage || 'Unknown error'
                };
            }
        } catch (error: any) {
            return {
                success: false,
                errorMessage: error.message
            };
        }
    }

    /**
     * Gets user information using the provided credentials
     * 
     * @param credentials Steam credentials
     * @returns Promise resolving to user information
     */
    async getUserInfo(credentials: SteamCredentials): Promise<any> {
        try {
            return await this.makeRequest({
                method: 'GET',
                path: '/api/steam/user',
                headers: {
                    'X-Steam-Username': credentials.username,
                    'X-Steam-Token': credentials.refreshToken
                }
            });
        } catch (error: any) {
            throw new Error(`Failed to fetch user info: ${error.message}`);
        }
    }

    /**
     * Adds an event listener
     * 
     * @param event Event name to listen for
     * @param callback Function to call when event occurs
     */
    on<T extends SteamAuthEvent>(event: T, callback: Function): void {
        if (!this.eventListeners.has(event)) {
            this.eventListeners.set(event, []);
        }
        this.eventListeners.get(event)?.push(callback);
    }

    /**
     * Removes an event listener
     * 
     * @param event Event name
     * @param callback Function to remove
     */
    off<T extends SteamAuthEvent>(event: T, callback: Function): void {
        if (!this.eventListeners.has(event)) {
            return;
        }

        const listeners = this.eventListeners.get(event);
        if (listeners) {
            const index = listeners.indexOf(callback);
            if (index !== -1) {
                listeners.splice(index, 1);
            }
        }
    }

    /**
     * Removes all event listeners
     */
    removeAllListeners(): void {
        this.eventListeners.clear();
    }

    /**
     * Closes the active socket connection
     */
    closeSocket(): void {
        if (this.activeSocket) {
            this.activeSocket.end();
            this.activeSocket = null;
        }
    }

    /**
     * Cleans up resources
     */
    destroy(): void {
        this.closeSocket();
        this.removeAllListeners();
    }

    /**
     * Internal method to emit events to listeners
     * 
     * @param event Event name
     * @param data Event data
     */
    private emit<T extends SteamAuthEvent>(event: T, data: any): void {
        const listeners = this.eventListeners.get(event);
        if (listeners) {
            for (const callback of listeners) {
                callback(data);
            }
        }
    }

    /**
     * Makes HTTP requests over Unix socket
     * 
     * @param options Request options
     * @returns Promise resolving to response
     */
    private makeRequest(options: {
        method: string;
        path: string;
        headers?: Record<string, string>;
        body?: any;
    }): Promise<any> {
        return new Promise((resolve, reject) => {
            const req = httpRequest({
                socketPath: this.socketPath,
                method: options.method,
                path: options.path,
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    ...options.headers
                }
            }, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            if (data && data.length > 0) {
                                resolve(JSON.parse(data));
                            } else {
                                resolve(null);
                            }
                        } catch (e) {
                            resolve(data); // Return raw data if not JSON
                        }
                    } else {
                        reject(new Error(`Request failed with status ${res.statusCode}: ${data}`));
                    }
                });
            });

            req.on('error', (error) => {
                reject(error);
            });

            if (options.body) {
                req.write(JSON.stringify(options.body));
            }
            req.end();
        });
    }
}