import * as net from 'net';
import * as readline from 'readline';
import * as fs from 'fs';
import * as qrcode from 'qrcode-terminal';

// Socket path
const SOCKET_PATH = '/tmp/steam.sock';

// Types for messages
interface BaseMessage {
  type: string;
}

interface LoginRequest extends BaseMessage {
  type: 'login';
  username?: string;
  refreshToken?: string;
}

interface DisconnectRequest extends BaseMessage {
  type: 'disconnect';
}

interface ChallengeUrlResponse extends BaseMessage {
  type: 'challenge_url';
  url: string;
  timestamp: string;
}

interface CredentialsResponse extends BaseMessage {
  type: 'credentials';
  username: string;
  refreshToken: string;
}

interface StatusResponse extends BaseMessage {
  type: 'status';
  message: string; 
}

interface ErrorResponse extends BaseMessage {
  type: 'error';
  message: string;
}

interface AccountInfoResponse extends BaseMessage {
  type: 'account_info';
  personaName: string;
  country: string;
}

interface UserDataResponse extends BaseMessage {
  type: 'user_data';
  username: string;
  personaName: string;
  avatarUrl: string;
  timestamp: string;
}

type ServerResponse = 
  | ChallengeUrlResponse
  | CredentialsResponse
  | StatusResponse
  | ErrorResponse
  | AccountInfoResponse
  | UserDataResponse;

class SteamSocketClient {
  private socket: net.Socket | null = null;
  private connected = false;
  private rl: readline.Interface;
  private credentials: { username: string; refreshToken: string } | null = null;
  private credentialsFile = '/tmp/steam_credentials.json';

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  async start() {
    console.log('Steam Socket Client starting...');
    
    try {
      this.loadCredentials();
      
      this.socket = net.createConnection(SOCKET_PATH);
      
      this.socket.on('connect', () => this.onConnected());
      this.socket.on('data', (data) => this.onDataReceived(data));
      this.socket.on('error', (err) => {
        console.error('Socket error:', err.message);
        this.cleanup();
      });
      this.socket.on('close', () => {
        console.log('Connection closed');
        this.cleanup();
      });
    } catch (err) {
      console.error('Failed to start client:', err);
      this.cleanup();
    }
  }

  private onConnected() {
    console.log('Connected to server');
    this.connected = true;
    
    if (this.credentials) {
      this.askUseCredentials();
    } else {
      this.promptForLoginMethod();
    }
  }

  private promptForLoginMethod() {
    this.rl.question('Do you want to use QR code login (q) or direct login with credentials (d)? ', (answer) => {
      if (answer.toLowerCase() === 'd') {
        this.promptForCredentials();
      } else {
        this.sendMessage({ type: 'login' });
        console.log('Starting QR code login. Please wait for the QR code...');
      }
    });
  }

  private askUseCredentials() {
    this.rl.question(`Saved credentials found for ${this.credentials!.username}. Use them? (y/n) `, (answer) => {
      if (answer.toLowerCase() === 'y') {
        this.sendMessage({
          type: 'login',
          username: this.credentials!.username,
          refreshToken: this.credentials!.refreshToken
        });
        console.log(`Attempting login with saved credentials for ${this.credentials!.username}...`);
      } else {
        this.promptForLoginMethod();
      }
    });
  }

  private promptForCredentials() {
    this.rl.question('Enter username: ', (username) => {
      this.rl.question('Enter refresh token: ', (refreshToken) => {
        this.sendMessage({
          type: 'login',
          username,
          refreshToken
        });
        console.log(`Attempting login with provided credentials for ${username}...`);
      });
    });
  }

  private onDataReceived(data: Buffer) {
    try {
      const message = JSON.parse(data.toString()) as ServerResponse;
      
      switch (message.type) {
        case 'challenge_url':
          this.handleChallengeUrl(message);
          break;
        case 'credentials':
          this.handleCredentials(message);
          break;
        case 'account_info':
        case 'user_data':
          console.log(`\n${message.type.toUpperCase()}:`);
          console.log(JSON.stringify(message, null, 2));
          break;
        case 'status':
          console.log(`\nSTATUS: ${message.message}`);
          break;
        case 'error':
          console.error(`\nERROR: ${message.message}`);
          break;
        default:
          console.log('\nRECEIVED:', JSON.stringify(message, null, 2));
      }
    } catch (err) {
      console.error('Error parsing message:', data.toString(), err);
    }
  }

  private handleChallengeUrl(message: ChallengeUrlResponse) {
    console.log('\n========== QR CODE LOGIN URL ==========');
    console.log(message.url);
    console.log('Scan this URL with the Steam mobile app');
    console.log('=======================================\n');

    // Generate QR code in terminal
    qrcode.generate(message.url, { small: true }, (qrcode) => {
      console.log(qrcode);
    });
  }

  private handleCredentials(message: CredentialsResponse) {
    console.log('\n========== CREDENTIALS RECEIVED ==========');
    console.log('Username:', message.username);
    console.log('Refresh Token:', message.refreshToken);
    console.log('==========================================\n');
    
    // Save credentials
    this.credentials = {
      username: message.username,
      refreshToken: message.refreshToken
    };
    
    this.saveCredentials();
  }

  private loadCredentials() {
    try {
      if (fs.existsSync(this.credentialsFile)) {
        const data = fs.readFileSync(this.credentialsFile, 'utf8');
        this.credentials = JSON.parse(data);
        console.log(`Found saved credentials for ${this.credentials!.username}`);
      }
    } catch (err) {
      console.log('No saved credentials found or error loading them');
    }
  }

  private saveCredentials() {
    if (this.credentials) {
      fs.writeFileSync(this.credentialsFile, JSON.stringify(this.credentials, null, 2));
      console.log('Credentials saved for future use');
    }
  }

  private sendMessage(message: LoginRequest | DisconnectRequest) {
    if (this.socket && this.connected) {
      this.socket.write(JSON.stringify(message));
    } else {
      console.error('Cannot send message: not connected');
    }
  }

  public disconnect() {
    if (this.socket && this.connected) {
      this.sendMessage({ type: 'disconnect' });
    }
  }

  private cleanup() {
    if (this.socket) {
      try {
        this.socket.end();
      } catch (err) {
        // Ignore errors on cleanup
      }
      this.socket = null;
    }
    
    if (this.rl) {
      this.rl.close();
    }
  }
}

// Create and start the client
const client = new SteamSocketClient();
client.start();

// Handle process termination
process.on('SIGINT', () => {
  console.log('\nDisconnecting...');
  client.disconnect();
  setTimeout(() => process.exit(0), 500);
});