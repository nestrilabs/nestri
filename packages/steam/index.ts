import { Socket } from 'node:net';
import { connect as netConnect } from 'node:net';
import { request as httpRequest } from 'node:http';

/**
 * Event types emitted by the SteamAuthClient
 */
export enum SteamAuthEvent {
    CHALLENGE_URL = 'challenge_url',
    STATUS_UPDATE = 'status_update',
    CREDENTIALS = 'credentials',
    LOGIN_SUCCESS = 'login_success',
    LOGIN_ERROR = 'login_error',
    RECONNECTING = 'reconnecting',
    RECONNECT_SUCCESS = 'reconnect_success',
    RECONNECT_FAILURE = 'reconnect_failure',
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
    maxReconnectAttempts?: number;
    reconnectDelay?: number;
    requestTimeout?: number;
    socketTimeout?: number;
}

type Listener<T = any> = (payload: T) => void;

/**
 * SteamAuthClient provides methods to authenticate with Steam
 * through a C# service over Unix sockets.
 */
export class SteamAuthClient {
    private socketPath: string;
    private activeSocket: Socket | null = null;
    private eventListeners: Map<SteamAuthEvent, Listener[]> = new Map();
    private reconnectAttempts: number = 0;
    private maxReconnectAttempts: number;
    private reconnectDelay: number;
    private requestTimeout: number;
    private socketTimeout: number;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private isReconnecting: boolean = false;
    private lastEventData: Map<SteamAuthEvent, any> = new Map();

    /**
     * Creates a new Steam authentication client
     * 
     * @param options Configuration options
     */
    constructor(options: SteamAuthClientOptions = {}) {
        this.socketPath = options.socketPath || '/tmp/steam.sock';
        this.maxReconnectAttempts = options.maxReconnectAttempts || 3;
        this.reconnectDelay = options.reconnectDelay || 2000; // 2 seconds
        this.requestTimeout = options.requestTimeout || 30000; // 30 seconds
        this.socketTimeout = options.socketTimeout || 60000; // 60 seconds
    }

    /**
     * Checks if the Steam service is healthy
     * 
     * @returns Promise resolving to true if service is healthy
     */
    async checkHealth(): Promise<boolean> {
        try {
            await this.makeRequest({ 
                method: 'GET', 
                path: '/',
                timeout: 5000 // Use shorter timeout for health checks
            });
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
        return new Promise<void>((resolve, reject) => {
            // Close any existing connection
            this.closeSocket();
            
            // Reset reconnect attempts
            this.reconnectAttempts = 0;
            
            // Attempt to connect
            this.connectSocket()
                .then(() => {
                    // Handle successful connection
                    this.emit(SteamAuthEvent.STATUS_UPDATE, { message: "Connected to Steam service" });
                })
                .catch((error) => {
                    this.emit(SteamAuthEvent.ERROR, { error: error.message || "Failed to connect to Steam service" });
                    reject(error);
                });
                
            // Create handlers for login success/failure
            const successHandler = (data: any) => {
                this.off(SteamAuthEvent.LOGIN_SUCCESS, successHandler);
                this.off(SteamAuthEvent.LOGIN_ERROR, errorHandler);
                resolve();
            };
            
            const errorHandler = (data: any) => {
                this.off(SteamAuthEvent.LOGIN_SUCCESS, successHandler);
                this.off(SteamAuthEvent.LOGIN_ERROR, errorHandler);
                resolve(); // Resolve but with error already emitted
            };
            
            // Register handlers
            this.on(SteamAuthEvent.LOGIN_SUCCESS, successHandler);
            this.on(SteamAuthEvent.LOGIN_ERROR, errorHandler);
        });
    }

    /**
     * Connects to the Steam service via Unix socket
     * 
     * @returns Promise that resolves when connection is established
     */
    private connectSocket(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            try {
                // Create Socket connection for SSE
                this.activeSocket = netConnect({ path: this.socketPath });
                
                // Set socket timeout
                this.activeSocket.setTimeout(this.socketTimeout);

                // Build the HTTP request manually for SSE
                const request =
                    'GET /api/steam/login HTTP/1.1\r\n' +
                    'Host: localhost\r\n' +
                    'Accept: text/event-stream\r\n' +
                    'Cache-Control: no-cache\r\n' +
                    'Connection: keep-alive\r\n\r\n';

                // Connection timeout
                const connectionTimeout = setTimeout(() => {
                    if (this.activeSocket) {
                        this.activeSocket.destroy();
                        reject(new Error('Connection timed out'));
                    }
                }, this.requestTimeout);

                this.activeSocket.on('connect', () => {
                    clearTimeout(connectionTimeout);
                    this.activeSocket?.write(request);
                    this.setupSocketDataHandling();
                    resolve();
                });

                this.activeSocket.on('timeout', () => {
                    this.emit(SteamAuthEvent.ERROR, { error: 'Socket connection timed out' });
                    this.tryReconnect();
                });

                this.activeSocket.on('error', (error) => {
                    clearTimeout(connectionTimeout);
                    this.emit(SteamAuthEvent.ERROR, { error: error.message });
                    reject(error);
                });

                this.activeSocket.on('close', (hadError) => {
                    if (hadError) {
                        this.emit(SteamAuthEvent.ERROR, { error: 'Connection closed due to error' });
                    } else {
                        this.emit(SteamAuthEvent.STATUS_UPDATE, { message: 'Connection closed' });
                    }
                    
                    // Try to reconnect if not deliberately closed
                    if (this.activeSocket !== null) {
                        this.tryReconnect();
                    }
                });
            } catch (error: any) {
                reject(error);
            }
        });
    }

    /**
     * Set up data handling and event parsing for the socket
     */
    private setupSocketDataHandling(): void {
        if (!this.activeSocket) return;

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

                            // Store last event data for potential reconnects
                            if (eventType === 'challenge_url' || eventType === 'status') {
                                this.lastEventData.set(eventType as SteamAuthEvent, parsedData);
                            }

                            // Handle specific events
                            if (eventType === 'challenge_url') {
                                this.emit(SteamAuthEvent.CHALLENGE_URL, parsedData.url);
                            } else if (eventType === 'credentials') {
                                // Store credentials and emit success event
                                this.emit(SteamAuthEvent.CREDENTIALS, {
                                    username: parsedData.username,
                                    refreshToken: parsedData.refreshToken
                                });
                            } else if (eventType === 'login-successful') {
                                // Emit login success and clean up
                                this.emit(SteamAuthEvent.LOGIN_SUCCESS, { steamId: parsedData.steamId });
                            } else if (eventType === 'status') {
                                this.emit(SteamAuthEvent.STATUS_UPDATE, parsedData);
                            } else if (eventType === 'error' || eventType === 'login-unsuccessful') {
                                this.emit(SteamAuthEvent.LOGIN_ERROR, {
                                    message: parsedData.message || parsedData.error || 'Authentication failed'
                                });
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
    }

    /**
     * Attempt to reconnect to the server
     */
    private tryReconnect(): void {
        // Don't attempt to reconnect if we're already in the process
        if (this.isReconnecting) return;
        
        // Don't reconnect if we've exceeded max attempts
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            this.emit(SteamAuthEvent.RECONNECT_FAILURE, { 
                message: `Failed to reconnect after ${this.maxReconnectAttempts} attempts` 
            });
            return;
        }
        
        this.isReconnecting = true;
        this.reconnectAttempts++;
        
        // Notify about reconnection attempt
        this.emit(SteamAuthEvent.RECONNECTING, { 
            attempt: this.reconnectAttempts,
            maxAttempts: this.maxReconnectAttempts
        });
        
        // Clean up existing socket
        this.closeSocket(false);
        
        // Schedule reconnect attempt
        this.reconnectTimer = setTimeout(() => {
            this.connectSocket()
                .then(() => {
                    this.isReconnecting = false;
                    this.emit(SteamAuthEvent.RECONNECT_SUCCESS, { 
                        attempt: this.reconnectAttempts 
                    });
                    
                    // Re-emit the last challenge URL if available
                    const lastUrl = this.lastEventData.get(SteamAuthEvent.CHALLENGE_URL);
                    if (lastUrl) {
                        this.emit(SteamAuthEvent.CHALLENGE_URL, lastUrl.url);
                    }
                })
                .catch(() => {
                    this.isReconnecting = false;
                    // Will trigger another reconnect attempt via the close handler
                    // if we haven't reached max attempts
                });
        }, this.reconnectDelay * this.reconnectAttempts); // Increasing backoff
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
                body: credentials,
                timeout: this.requestTimeout
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
                },
                timeout: this.requestTimeout
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
    on<T extends SteamAuthEvent>(event: T, callback: Listener): void {
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
    off<T extends SteamAuthEvent>(event: T, callback?: Listener): void {
        if (!this.eventListeners.has(event)) {
            return;
        }

        if (callback) {
            const listeners = this.eventListeners.get(event);
            if (listeners) {
                const index = listeners.indexOf(callback);
                if (index !== -1) {
                    listeners.splice(index, 1);
                }
            }
        } else {
            // Remove all listeners for this event
            this.eventListeners.delete(event);
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
     * 
     * @param clearSocket Whether to clear the socket reference
     */
    closeSocket(clearSocket = true): void {
        if (this.activeSocket) {
            this.activeSocket.removeAllListeners();
            this.activeSocket.end();
            this.activeSocket.destroy();
            
            if (clearSocket) {
                this.activeSocket = null;
            }
        }
        
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }

    /**
     * Cleans up resources
     */
    destroy(): void {
        this.closeSocket();
        this.removeAllListeners();
        this.lastEventData.clear();
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
            for (const callback of [...listeners]) { // Create a copy to avoid mutation issues during iteration
                try {
                    callback(data);
                } catch (error) {
                    console.error(`Error in listener for event ${event}:`, error);
                }
            }
        }
    }

    /**
     * Makes HTTP requests over Unix socket with timeout
     * 
     * @param options Request options
     * @returns Promise resolving to response
     */
    private makeRequest(options: {
        method: string;
        path: string;
        headers?: Record<string, string>;
        body?: any;
        timeout?: number;
    }): Promise<any> {
        return new Promise((resolve, reject) => {
            const requestTimeout = options.timeout || this.requestTimeout;
            
            // Create timeout for the entire request
            const timeout = setTimeout(() => {
                reject(new Error(`Request to ${options.path} timed out after ${requestTimeout}ms`));
            }, requestTimeout);

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
                    clearTimeout(timeout);
                    
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
                        let errorMessage = `Request failed with status ${res.statusCode}`;
                        try {
                            if (data) {
                                const errorData = JSON.parse(data);
                                errorMessage = errorData.message || errorData.error || errorMessage;
                            }
                        } catch {
                            errorMessage = data ? `${errorMessage}: ${data}` : errorMessage;
                        }
                        reject(new Error(errorMessage));
                    }
                });
            });

            req.on('error', (error) => {
                clearTimeout(timeout);
                reject(error);
            });

            if (options.body) {
                req.write(JSON.stringify(options.body));
            }
            req.end();
        });
    }
}