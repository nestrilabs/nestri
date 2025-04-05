import { spawn } from "child_process";
import { EventEmitter } from "events";

export interface SteamCredentials {
    username: string;
    accessToken: string;
    personaName: string;
    avatarUrl: string;
    country: string;
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
    private errorOccurred: boolean = false;

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
                console.log("Setting executable permissions for", this.csharpAppPath);
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
            this.errorOccurred = false;

            // Ensure executable permissions first
            await this.ensureExecutable();

            console.log("Starting Steam authentication process...");
            this.authProcess = spawn(this.csharpAppPath, [], {
                stdio: ['pipe', 'pipe', 'pipe']
            });
            
            if (!this.authProcess) {
                throw new Error("Failed to spawn Steam authentication process");
            }
            
            if (this.authProcess.stdout) {
                // Listen for data from stdout
                this.authProcess.stdout.on("data", (data) => {
                    const output = data.toString();
                    console.log("C# raw output:", output);

                    // Try to parse any JSON in the output
                    try {
                        // Look for JSON objects in the text
                        const jsonMatches = output.match(/(\{.*?\})/g);
                        if (jsonMatches) {
                            for (const jsonStr of jsonMatches) {
                                try {
                                    const jsonData = JSON.parse(jsonStr);
                                    console.log("Parsed JSON:", jsonData);

                                    // Check if this JSON contains a challenge URL
                                    if (jsonData.challengeUrl) {
                                        const newUrl = jsonData.challengeUrl;
                                        this.challengeUrl = newUrl;
                                        this.emit('challengeUrl', newUrl);
                                    }

                                    // Check for errors
                                    if (jsonData.error || jsonData.message) {
                                        const errorMsg = jsonData.error || jsonData.message;
                                        console.log("Found error:", errorMsg);
                                        this.errorOccurred = true;
                                        this.emit('error', new Error(errorMsg));
                                    }

                                    // More flexible credentials detection: 
                                    // Look for typical Steam credential fields
                                    const possibleCredFields = [
                                        'username', 'accessToken', 'steamId', 'token',
                                        'personaName', 'avatarUrl', 'accountName'
                                    ];
                                    
                                    // Check if the JSON has enough credential-like fields
                                    const credFieldsFound = possibleCredFields.filter(
                                        field => jsonData[field] !== undefined
                                    );
                                    
                                    // If we have at least username or access token plus one more field,
                                    // consider it credentials
                                    if ((jsonData.username || jsonData.accessToken) && 
                                        credFieldsFound.length >= 2) {
                                        console.log("Found credential-like data with fields:", credFieldsFound);
                                        
                                        // Ensure we have the required fields
                                        const credentials: SteamCredentials = {
                                            username: jsonData.username || jsonData.accountName || "unknown",
                                            accessToken: jsonData.accessToken || jsonData.token || "unknown",
                                            personaName: jsonData.personaName || jsonData.username || "unknown",
                                            avatarUrl: jsonData.avatarUrl || "",
                                            country: jsonData.country || "",
                                            ...jsonData // Include all other fields
                                        };
                                        
                                        this.credentials = credentials;
                                        console.log("Emitting credentials event");
                                        this.emit('credentials', this.credentials);
                                    }
                                } catch (innerError) {
                                    console.error("Error parsing JSON object:", innerError);
                                }
                            }
                        }
                    } catch (e) {
                        console.log("Not valid JSON or error parsing:", e);
                        // Not valid JSON, continue listening
                    }
                });
            }

            if (this.authProcess.stderr) {
                // Handle errors
                this.authProcess.stderr.on("data", (data) => {
                    const errorMsg = data.toString();
                    console.error("C# error:", errorMsg);
                    this.errorOccurred = true;
                    this.emit('error', new Error(errorMsg));
                });
            }

            // Process completion
            this.authProcess.on("close", (code) => {
                console.log(`C# process exited with code ${code}`);
                
                if (code !== 0 && !this.errorOccurred) {
                    this.errorOccurred = true;
                    const error = new Error(`C# process exited with code ${code}`);
                    this.emit('error', error);
                }
                
                this.completeAuth();
            });

            // Set a timeout in case the process hangs
            this.timeout = setTimeout(() => {
                const timeoutError = new Error("Timeout waiting for authentication");
                console.error(timeoutError.message);
                this.errorOccurred = true;
                this.emit('error', timeoutError);
                this.completeAuth();
            }, this.timeoutDuration);

        } catch (error: any) {
            console.error("Steam authentication error:", error.message);
            this.errorOccurred = true;
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
            credentials: this.credentials || undefined,
            error: this.errorOccurred ? "An error occurred during authentication" : undefined
        };
    }

    /**
     * Completes the authentication process and cleans up resources
     * @private
     */
    private completeAuth(): void {
        const result: SteamAuthResult = this.getState();

        if (!this.credentials && this.challengeUrl && !this.errorOccurred) {
            result.error = "Process completed before obtaining credentials";
        }

        console.log("Authentication completed with result:", result);
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