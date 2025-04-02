// steam.ts
import { spawn } from "child_process";
import { EventEmitter } from "events";

export interface SteamCredentials {
    username: string;
    accessToken: string;
    [key: string]: any; // For any additional fields
}

export interface SteamAuthResult {
    challengeUrl?: string;
    credentials?: SteamCredentials;
    error?: string;
}

// Define types for the event listeners
export interface SteamAuthEvents {
    challengeUrl: (url: string) => void;
    credentials: (creds: SteamCredentials) => void;
    error: (error: Error) => void;
    completed: (result: SteamAuthResult) => void;
}

export class Steam extends EventEmitter {
    private csharpAppPath: string;
    private timeoutDuration: number;
    private authProcess: ReturnType<typeof spawn> | null = null;
    private challengeUrl: string | null = null;
    private credentials: SteamCredentials | null = null;
    private timeout: NodeJS.Timeout | null = null;

    /**
     * Creates a new Steam authentication client
     * @param csharpAppPath Path to the C# executable for Steam authentication
     * @param timeoutDuration Timeout in milliseconds for the authentication process (default: 120000 [2 minutes])
     */
    constructor(csharpAppPath: string = "./bin/steam", timeoutDuration: number = 120000) {
        super();
        this.csharpAppPath = csharpAppPath;
        this.timeoutDuration = timeoutDuration;
    }

    /**
     * Register an event listener
     * @param event Event to listen for ('challengeUrl', 'credentials', 'error', 'completed')
     * @param listener Callback function to execute when the event occurs
     */
    on<K extends keyof SteamAuthEvents>(
        event: K,
        listener: SteamAuthEvents[K]
    ): this {
        return super.on(event, listener);
    }

    /**
     * Ensure the C# executable has the proper execution permissions
     */
    async ensureExecutable(): Promise<void> {
        try {
            const { exec } = await import("child_process");
            return new Promise((resolve, reject) => {
                console.log("dirname", __dirname)
                exec(`chmod +x ${this.csharpAppPath}`, (error) => {
                    if (error) {
                        reject(new Error(`Failed to set executable permissions: ${error.message}`));
                        return;
                    }
                    resolve();
                });
            });
        } catch (error: any) {
            throw new Error(`Failed to set executable permissions: ${error.message}`);
        }
    }

    /**
     * Start the authentication process
     * The method will emit events as the process progresses
     * - 'challengeUrl' when the challenge URL is available
     * - 'credentials' when login credentials are available
     * - 'error' if any error occurs
     * - 'completed' when the entire process completes
     */
    async startAuth(): Promise<void> {
        try {
            // Clean up any previous state
            this.cleanup();

            // Ensure executable permissions first
            await this.ensureExecutable();

            console.log("Starting Steam authentication process...");
            this.authProcess = spawn(this.csharpAppPath, [], {
                stdio: ['pipe', 'pipe', 'pipe']
            });
            if (this.authProcess.stdout) {
                // Listen for data from stdout
                this.authProcess.stdout.on("data", (data) => {
                    const output = data.toString();
                    console.log("C# output:", output);

                    // Try to parse any JSON in the output
                    try {
                        // Look for JSON objects in the text
                        const jsonMatches = output.match(/(\{.*?\})/g);
                        if (jsonMatches) {
                            for (const jsonStr of jsonMatches) {
                                const jsonData = JSON.parse(jsonStr);

                                // Check if this JSON contains a challenge URL - emit for ALL URL updates
                                if (jsonData.challengeUrl) {
                                    const newUrl = jsonData.challengeUrl;
                                    // Always emit the event, even if the URL is the same
                                    console.log("Found challenge URL:", newUrl);
                                    this.challengeUrl = newUrl; // Update the stored URL
                                    this.emit('challengeUrl', newUrl);
                                }

                                // Check if this JSON contains credentials
                                if (jsonData.username && jsonData.accessToken) {
                                    this.credentials = jsonData;
                                    console.log("Found login credentials");
                                    this.emit('credentials', this.credentials);

                                    // Once we have credentials, we can complete the process
                                    this.completeAuth();
                                }
                            }
                        }
                    } catch (e) {
                        // Not valid JSON, continue listening
                    }

                    // As a fallback, check for the original format
                    const urlMatch = output.match(/Challenge URL: (https:\/\/[^\s]+)/);
                    if (urlMatch && urlMatch[1]) {
                        const newUrl = urlMatch[1];
                        if (this.challengeUrl !== newUrl) {
                            this.challengeUrl = newUrl;
                            console.log("Found challenge URL (old format):", this.challengeUrl);
                            this.emit('challengeUrl', this.challengeUrl);
                        }
                    }
                });
            }


            if (this.authProcess.stderr)
                // Handle errors
                this.authProcess.stderr.on("data", (data) => {
                    console.error("C# error:", data.toString());
                });

            // Process completion
            this.authProcess.on("close", (code) => {
                if (!this.credentials && !this.challengeUrl) {
                    const error = new Error(`C# process exited with code ${code} before providing any useful data`);
                    this.emit('error', error);
                }
                this.completeAuth();
            });

            // Set a timeout in case the process hangs
            this.timeout = setTimeout(() => {
                const timeoutError = new Error("Timeout waiting for authentication");
                console.error(timeoutError.message);
                this.emit('error', timeoutError);
                this.completeAuth();
            }, this.timeoutDuration);

        } catch (error: any) {
            console.error("Steam authentication error:", error.message);
            this.emit('error', error);
            this.completeAuth();
        }
    }

    /**
     * Cancel an ongoing authentication process
     */
    cancel(): void {
        console.log("Cancelling Steam authentication process");
        this.completeAuth();
    }

    /**
     * Get the current state of the authentication process
     */
    getState(): SteamAuthResult {
        return {
            challengeUrl: this.challengeUrl || undefined,
            credentials: this.credentials || undefined
        };
    }

    /**
     * Completes the authentication process and cleans up resources
     * @private
     */
    private completeAuth(): void {
        const result: SteamAuthResult = this.getState();

        if (!this.credentials && this.challengeUrl) {
            result.error = "Process completed before obtaining credentials";
        }

        this.emit('completed', result);
        this.cleanup();
    }

    /**
     * Clean up resources associated with the auth process
     * @private
     */
    private cleanup(): void {
        if (this.timeout) {
            clearTimeout(this.timeout);
            this.timeout = null;
        }

        if (this.authProcess) {
            try {
                this.authProcess.kill('SIGTERM');
            } catch (e) {
                // Ignore errors when killing the process
            }
            this.authProcess = null;
        }
    }
}