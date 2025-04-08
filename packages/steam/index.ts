import WebSocket from 'ws';
import http from 'http';
import url from "url"
// import net from 'net';

// Path to Unix socket
const SOCKET_PATH = '/tmp/steam.sock';

function makeHttpRequest(path: string) {
    return new Promise((resolve, reject) => {
        const options = {
            socketPath: SOCKET_PATH,
            path: path,
            method: 'GET'
        };

        const req = http.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                console.log(`HTTP Status Code: ${res.statusCode}`);
                resolve(data);
            });
        });

        req.on('error', (error) => {
            console.error(`Error making request: ${error.message}`);
            reject(error);
        });

        req.end();
    });
}

// Function to connect via WebSocket
async function connectWebSocket() {
    try {
        // We can use a Unix socket with the ws library by providing a custom connection
        const ws = new WebSocket('unix:/tmp/steam.sock');

        ws.addEventListener('open', () => {
            console.log('Bun WebSocket connected!');
            ws.send('Hello from Bun client!');

            // Send periodic messages
            const interval = setInterval(() => {
                if (ws.readyState === ws.OPEN) {
                    ws.send(`Bun ping at ${new Date().toISOString()}`);
                } else {
                    clearInterval(interval);
                }
            }, 10000);
        });

        ws.addEventListener('message', (event) => {
            console.log(`Received from server: ${event.data}`);
        });

        ws.addEventListener('close', () => {
            console.log('WebSocket connection closed');
        });

        ws.addEventListener('error', (error) => {
            console.error('WebSocket error:', error);
        });

        return ws;
    } catch (error) {
        console.error('Error creating WebSocket:', error);

        // Fall back to regular HTTP-based communication
        console.log('Falling back to HTTP communication');
        const rootResponse = await makeHttpRequest('/');
        console.log('Server root response:', rootResponse);
    }

}

// Function to access the SSE endpoint for long-running process
function connectToLongProcess() {
    console.log('\nStarting long process with progress updates:');

    const options = {
        socketPath: SOCKET_PATH,
        path: '/api/longprocess',
        method: 'GET',
        headers: {
            'Accept': 'text/event-stream'
        }
    };

    const req = http.request(options, (res) => {
        res.on('data', (chunk) => {
            const lines = chunk.toString().split('\n\n');
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.substring(6);
                    try {
                        const parsedData = JSON.parse(data);
                        if (parsedData.progress !== undefined) {
                            console.log(`Progress: ${parsedData.progress}%`);
                        } else if (parsedData.status === 'completed') {
                            console.log('Long process completed!');
                        }
                    } catch (e) {
                        console.log(`Raw progress data: ${data}`);
                    }
                }
            }
        });

        res.on('end', () => {
            console.log('Long process connection closed');
        });
    });

    req.on('error', (error) => {
        console.error(`Error in long process: ${error.message}`);
    });

    req.end();
}

// Main function
async function runClient() {
    try {
        console.log('Connecting to Unix socket server...');

        // Connect to the WebSocket for real-time updates
        await connectWebSocket();

        // Connect to the long process endpoint after a delay
        setTimeout(() => {
            connectToLongProcess();
        }, 3000);

        // Keep the process running
        process.on('SIGINT', () => {
            console.log('Closing connections...');
            setTimeout(() => process.exit(0), 1000);
        });

        console.log('Press Ctrl+C to exit');

    } catch (error) {
        console.error('Client error:', error);
    }
}

// Run the client
runClient();