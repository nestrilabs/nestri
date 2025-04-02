import { $ } from "bun";
import { spawn } from "child_process";

// Path to your compiled C# executable (on Linux)
const csharpAppPath = "./bin/steam";

// Function to run the C# app and process JSON outputs
async function runCSharpAuth() {
    return new Promise((resolve, reject) => {
        // Spawn the C# process
        const csharpProcess = spawn(csharpAppPath, [], {
            stdio: ['pipe', 'pipe', 'pipe']
        });

        let challengeUrl: any = null;
        let credentials: any = null;
        let timeout: any = null;

        // Listen for data from stdout
        csharpProcess.stdout.on("data", (data) => {
            const output = data.toString();
            console.log("C# output:", output);

            // Try to parse any JSON in the output
            try {
                // Look for JSON objects in the text
                const jsonMatches = output.match(/(\{.*?\})/g);
                if (jsonMatches) {
                    for (const jsonStr of jsonMatches) {
                        const jsonData = JSON.parse(jsonStr);

                        // Check if this JSON contains a challenge URL
                        if (jsonData.challengeUrl) {
                            challengeUrl = jsonData.challengeUrl;
                            console.log("Found challenge URL:", challengeUrl);
                        }

                        // Check if this JSON contains credentials
                        if (jsonData.username && jsonData.accessToken) {
                            credentials = jsonData;
                            console.log("Found login credentials");

                            // Once we have credentials, resolve and terminate
                            clearTimeout(timeout);
                            csharpProcess.kill('SIGTERM');
                            resolve({ challengeUrl, credentials });
                            return;
                        }
                    }
                }
            } catch (e) {
                // Not valid JSON, continue listening
            }

            // As a fallback, check for the original format
            const urlMatch = output.match(/Challenge URL: (https:\/\/[^\s]+)/);
            if (!challengeUrl && urlMatch && urlMatch[1]) {
                challengeUrl = urlMatch[1];
                console.log("Found challenge URL (old format):", challengeUrl);
            }
        });

        // Handle errors
        csharpProcess.stderr.on("data", (data) => {
            console.error("C# error:", data.toString());
        });

        // Process completion
        csharpProcess.on("close", (code) => {
            clearTimeout(timeout);
            if (credentials) {
                // If we have credentials, everything is good
                resolve({ challengeUrl, credentials });
            } else if (challengeUrl) {
                // If we only have the URL but the process ended, report partial success
                resolve({ challengeUrl, error: "Process terminated before obtaining credentials" });
            } else {
                reject(new Error(`C# process exited with code ${code} before providing any useful data`));
            }
        });

        // Set a timeout in case the process hangs
        timeout = setTimeout(() => {
            if (challengeUrl) {
                // If we at least have the URL, consider it partial success
                csharpProcess.kill('SIGTERM');
                resolve({ challengeUrl, error: "Timeout waiting for credentials" });
            } else {
                csharpProcess.kill('SIGTERM');
                reject(new Error("Timeout waiting for any useful output"));
            }
        }, 120000); // 2 minutes timeout
    });
}

// Main function to run everything
async function main() {
    try {
        // First, make sure the executable has proper permissions
        await $`chmod +x ${csharpAppPath}`;

        console.log("Starting C# Steam authentication app...");
        const result = await runCSharpAuth();

        console.log("Steam authentication result:");
        console.log(JSON.stringify(result, null, 2));

    } catch (error: any) {
        console.error("Error running Steam authentication:", error.message);
        process.exit(1);
    }
}

// Run the main function
main();