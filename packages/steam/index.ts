import * as http from 'http';
import * as qrcode from 'qrcode-terminal';
import { json } from 'stream/consumers';

class Steam {
    httpClient: http.ClientRequest | null = null;
    socketPath: string = '/tmp/steam.sock';

    constructor() { }

    login() {
        const options = {
            socketPath: this.socketPath,
            path: "/login",
            method: 'GET',
            headers: {
                'Accept': 'text/event-stream',
                'user-id': 'usr_XXXXXXXXXXXXXXX'
            }
        };


        this.httpClient = http.request(options, (res) => {
            let buffer = '';

            res.on('data', (chunk) => {
                // Append the new chunk to our buffer
                buffer += chunk.toString();

                // Process complete events (separated by double newlines)
                const eventBlocks = buffer.split('\n\n');
                // Keep the last incomplete block (if any) in the buffer
                buffer = eventBlocks.pop() || '';

                // Process each complete event block
                for (const block of eventBlocks) {
                    if (block.trim() === '') continue;

                    const lines = block.split('\n');
                    let eventType = '';
                    let eventData = '';

                    // Parse the event and data from each block
                    for (const line of lines) {
                        if (line.startsWith('event:')) {
                            eventType = line.substring(6).trim();
                        } else if (line.startsWith('data:')) {
                            eventData = line.substring(5).trim();
                        }
                    }

                    // Process the event based on its type
                    this.handleEvent(eventType, eventData);
                }
            });

            res.on('end', () => {
                console.log('Login stream connection closed');
            });
        });

        this.httpClient.on('error', (error) => {
            console.error(`Error in login process: ${error.message}`);
        });

        this.httpClient.end();
    }

    handleEvent(eventType: string, eventData: string) {
        console.log(`Received event: ${eventType}\n`);

        try {
            const data = eventData ? JSON.parse(eventData) : {};

            switch (eventType) {
                case 'auth_required':
                    console.log('Authentication required');
                    break;

                case 'challenge_url':
                    if (data.url) {
                        console.log('\n========== QR CODE LOGIN URL ==========');
                        console.log(data.url);
                        console.log('Scan this URL with the Steam mobile app');
                        console.log('=======================================\n');

                        qrcode.generate(data.url, { small: true }, (qrcode) => {
                            console.log(qrcode);
                        });
                    }
                    break;

                case 'status':
                    console.log(`STATUS: ${data.message}\n`);
                    break;

                case "connected":
                    console.log('Connected to Steam login service\n');
                    break;
                    
                case 'success':
                    console.log('Login successful!\n');
                    console.log(`User: ${data.username || 'Unknown'}\n`);
                    break;

                case 'error':
                    console.error(`Login error: ${data.message || 'Unknown error'}\n`);
                    break;

                case 'login-unsuccessful':
                    console.error(`Login unsuccesful: ${data.message || 'Unknown error'}\n`);
                    break;

                case 'account_info':
                    console.log(`Account info: ${data.info || 'No info available'}\n`);
                    break;

                case 'login-attempt':
                    console.error(`Attempting to login to Steam\n`);
                    break;

                case 'login-successful':
                    console.error(`Login succesful: ${data.username}\n`);
                    break;

                case 'timeout':
                    console.log('Login request timed out\n');
                    break;

                default:
                    console.log(`Unhandled event type: ${eventType}\n`);
                    console.log('Data:', data);
            }
        } catch (e) {
            console.error(`Error processing event data: ${e}\n`);
            console.log(`Raw event data: ${eventData}\n`);
        }
    }

    makeGetRequest(path: string) {
        return new Promise((resolve, reject) => {
            const options = {
                socketPath: this.socketPath,
                path: path,
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'user-id': 'usr_XXXXXXXXXXXXXXX'
                }
            };

            this.httpClient = http.request(options, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    console.log(`Status Code: ${res.statusCode}`);
                    resolve(data);
                });
            });

            this.httpClient.on('error', (error) => {
                console.error(`Error making request: ${error.message}`);
                reject(error);
            });

            // req.write(body);
            this.httpClient.end();
        });
    }

    async getUser() {
        console.log('\nMaking GET request to /user endpoint:');
        const userResponse = await this.makeGetRequest('/user');
        console.log('Response:', JSON.parse(userResponse as any));
    }

    // Add a method to gracefully close the connection
    disconnect() {
        if (this.httpClient) {
            this.httpClient.destroy();
            this.httpClient = null;
            console.log('Disconnected from Steam login service');
        }
    }
}

// Example usage:
(async () => {
    const steam = new Steam();
    steam.login();
    // await steam.getUser();

    process.on('SIGINT', () => {
        console.log('Closing connections...');
        steam.disconnect();
        setTimeout(() => process.exit(0), 1000);
    });
})()

// Handle process termination
