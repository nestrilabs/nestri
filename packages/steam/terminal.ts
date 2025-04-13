import { Agent, request as httpRequest } from 'node:http';
import { connect as netConnect } from 'node:net';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import qrcode from 'qrcode-terminal';
import { createInterface } from 'node:readline';

// Socket path matching the one in your C# code
const SOCKET_PATH = '/tmp/steam.sock';
const CREDENTIALS_PATH = join(process.cwd(), 'steam-credentials.json');

// Create readline interface for user input
const rl = createInterface({
    input: process.stdin,
    output: process.stdout
});

// Function to prompt user for input
const question = (query: string): Promise<string> => {
    return new Promise(resolve => rl.question(query, resolve));
};

// Function to make HTTP requests over Unix socket
function makeRequest(options: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: any;
}): Promise<any> {
    return new Promise((resolve, reject) => {
        const req = httpRequest({
            socketPath: SOCKET_PATH,
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

// Check if credentials file exists
const credentialsExist = (): boolean => {
    return existsSync(CREDENTIALS_PATH);
};

// Load saved credentials
const loadCredentials = (): { username: string, refreshToken: string } => {
    try {
        const data = readFileSync(CREDENTIALS_PATH, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error loading credentials:', error);
        return { username: '', refreshToken: '' };
    }
};

// Save credentials to file
const saveCredentials = (credentials: { username: string, refreshToken: string }): void => {
    try {
        writeFileSync(CREDENTIALS_PATH, JSON.stringify(credentials, null, 2));
        console.log('💾 Credentials saved to', CREDENTIALS_PATH);
    } catch (error) {
        console.error('Error saving credentials:', error);
    }
};

// Test health check endpoint
async function testHealthCheck(): Promise<boolean> {
    console.log('\n🔍 Testing health check endpoint...');
    try {
        const response = await makeRequest({ method: 'GET', path: '/' });
        console.log('✅ Health check successful:', response);
        return true;
    } catch (error: any) {
        console.error('❌ Health check failed:', error.message);
        return false;
    }
}

// Test QR code login endpoint (SSE)
async function loginWithQrCode(): Promise<{ username: string, refreshToken: string } | null> {
    console.log('\n🔍 Starting QR code login...');

    return new Promise<{ username: string, refreshToken: string } | null>((resolve) => {
        // Create Socket connection for SSE
        const socket = netConnect({ path: SOCKET_PATH });

        // Build the HTTP request manually for SSE
        const request =
            'GET /api/steam/login HTTP/1.1\r\n' +
            'Host: localhost\r\n' +
            'Accept: text/event-stream\r\n' +
            'Cache-Control: no-cache\r\n' +
            'Connection: keep-alive\r\n\r\n';

        socket.on('connect', () => {
            console.log('📡 Connected to socket, sending SSE request...');
            socket.write(request);
        });

        socket.on('error', (error) => {
            console.error('❌ Socket error:', error.message);
            resolve(null);
        });

        // Simple parser for SSE events over raw socket
        let buffer = '';
        let eventType = '';
        let eventData = '';
        let credentials: { username: string, refreshToken: string } | null = null;

        socket.on('data', (data) => {
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
                            console.log(`📬 Received event [${eventType}]`);

                            // Handle specific events
                            if (eventType === 'challenge_url') {
                                console.log('⚠️ Please scan this QR code with the Steam mobile app to authenticate:');
                                qrcode.generate(parsedData.url, { small: true });
                            } else if (eventType === 'credentials') {
                                console.log('🔑 Received credentials!');
                                credentials = {
                                    username: parsedData.username,
                                    refreshToken: parsedData.refreshToken
                                };
                            }else if (eventType === 'status') {
                                console.log(`\n🔄 Status: ${parsedData.message}\n`);
                            } else if (eventType === 'login-success' || eventType === 'login-successful') {
                                console.log(`\n✅ Login successful, Steam ID: ${parsedData.steamId}\n`);
                                socket.end();
                                if (credentials) {
                                    saveCredentials(credentials);
                                }
                                resolve(credentials);
                            } else if (eventType === 'error' || eventType === 'login-unsuccessful') {
                                console.error('❌ Login failed:', parsedData.message || parsedData.error);
                                socket.end();
                                resolve(null);
                            }
                        } catch (e) {
                            console.error('❌ Error parsing event data:', e);
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

// Login with existing credentials
async function loginWithCredentials(credentials: { username: string, refreshToken: string }): Promise<boolean> {
    console.log('\n🔍 Logging in with saved credentials...');
    try {
        const response = await makeRequest({
            method: 'POST',
            path: '/api/steam/login-with-credentials',
            body: credentials
        });

        if (response.success) {
            console.log('✅ Login successful, Steam ID:', response.steamId);
            return true;
        } else {
            console.error('❌ Login failed:', response.errorMessage);
            return false;
        }
    } catch (error: any) {
        console.error('❌ Login request failed:', error.message);
        return false;
    }
}

// Get user info
async function getUserInfo(credentials: { username: string, refreshToken: string }): Promise<any> {
    console.log('\n🔍 Fetching user info...');
    try {
        const response = await makeRequest({
            method: 'GET',
            path: '/api/steam/user',
            headers: {
                'X-Steam-Username': credentials.username,
                'X-Steam-Token': credentials.refreshToken
            }
        });
        return response;
    } catch (error: any) {
        console.error('❌ Failed to fetch user info:', error.message);
        return null;
    }
}

// Main function
async function main() {
    // Check health first
    const isHealthy = await testHealthCheck();
    if (!isHealthy) {
        console.error('❌ Service appears to be down. Exiting...');
        rl.close();
        return;
    }

    let credentials: { username: string, refreshToken: string } | null = null;

    // Check if we have saved credentials
    if (credentialsExist()) {
        const useExisting = await question('🔑 Found saved credentials. Use them? (y/n): ');
        if (useExisting.toLowerCase() === 'y') {
            credentials = loadCredentials();
            const success = await loginWithCredentials(credentials);
            if (!success) {
                console.log('⚠️ Saved credentials failed. Let\'s try QR login instead.');
                credentials = await loginWithQrCode();
            }
        } else {
            credentials = await loginWithQrCode();
        }
    } else {
        console.log('🔑 No saved credentials found. Starting QR login...');
        credentials = await loginWithQrCode();
    }

    // If we have valid credentials, offer to fetch user info
    if (credentials) {
        const getInfo = await question('📋 Fetch user info? (y/n): ');
        if (getInfo.toLowerCase() === 'y') {
            const userInfo = await getUserInfo(credentials);
            if (userInfo) {
                console.log('\n👤 User Information:');
                console.log(JSON.stringify(userInfo, null, 2));
            }
        }
    } else {
        console.log('❌ Failed to obtain valid credentials.');
    }

    rl.close();
}

// Start the program
main().catch(error => {
    console.error('Unhandled error:', error);
    rl.close();
});