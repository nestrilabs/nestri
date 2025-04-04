import { useTeam } from "./context";
import { EventSource } from 'eventsource'
import { useOpenAuth } from "@openauthjs/solid";
import { createSignal, onCleanup } from "solid-js";
import { createInitializedContext } from "../common/context";

// Global connection state to prevent multiple instances
let globalEventSource: EventSource | null = null;
let globalReconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 1;
let isConnecting = false;
let activeConnection: SteamConnection | null = null;

// Type definitions for the events
interface SteamEventTypes {
  'connected': { sessionID: string };
  'challenge': { sessionID: string; url: string };
  'error': { message: string };
  'completed': { sessionID: string };
}

// Type for the connection
type SteamConnection = {
  addEventListener: <T extends keyof SteamEventTypes>(
    event: T,
    callback: (data: SteamEventTypes[T]) => void
  ) => () => void;
  removeEventListener: <T extends keyof SteamEventTypes>(
    event: T,
    callback: (data: SteamEventTypes[T]) => void
  ) => void;
  disconnect: () => void;
  isConnected: () => boolean;
}

interface SteamContext {
  ready: boolean;
  client: {
    // SSE connection for login
    login: {
      connect: () => Promise<SteamConnection>;
    };
  };
}

// Create the initialized context
export const { use: useSteam, provider: SteamProvider } = createInitializedContext(
  "Steam",
  () => {
    const team = useTeam();
    const auth = useOpenAuth();

    // Create the HTTP client for regular endpoints
    const client = {
      // SSE connection factory for login
      login: {
        connect: async (): Promise<SteamConnection> => {
          // Return existing connection if active
          if (activeConnection && globalEventSource && globalEventSource.readyState !== 2) {
            return activeConnection;
          }

          // Prevent multiple simultaneous connection attempts
          if (isConnecting) {
            console.log("Connection attempt already in progress, waiting...");
            // Wait for existing connection attempt to finish
            return new Promise((resolve) => {
              const checkInterval = setInterval(() => {
                if (!isConnecting && activeConnection) {
                  clearInterval(checkInterval);
                  resolve(activeConnection);
                }
              }, 100);
            });
          }

          isConnecting = true;

          const [isConnected, setIsConnected] = createSignal(false);

          // Store event listeners
          const listeners: Record<string, Array<(data: any) => void>> = {
            'connected': [],
            'challenge': [],
            'error': [],
            'completed': []
          };

          // Method to add event listeners
          const addEventListener = <T extends keyof SteamEventTypes>(
            event: T,
            callback: (data: SteamEventTypes[T]) => void
          ) => {
            if (!listeners[event]) {
              listeners[event] = [];
            }

            listeners[event].push(callback as any);

            // Return a function to remove this specific listener
            return () => {
              removeEventListener(event, callback);
            };
          };

          // Method to remove event listeners
          const removeEventListener = <T extends keyof SteamEventTypes>(
            event: T,
            callback: (data: SteamEventTypes[T]) => void
          ) => {
            if (listeners[event]) {
              const index = listeners[event].indexOf(callback as any);
              if (index !== -1) {
                listeners[event].splice(index, 1);
              }
            }
          };

          // Handle notifying listeners safely
          const notifyListeners = (eventType: string, data: any) => {
            if (listeners[eventType]) {
              listeners[eventType].forEach(callback => {
                try {
                  callback(data);
                } catch (error) {
                  console.error(`Error in ${eventType} event handler:`, error);
                }
              });
            }
          };

          // Initialize connection
          const initConnection = async () => {
            if (globalReconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
              console.log(`Maximum reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached. Giving up.`);
              notifyListeners('error', { message: 'Connection to Steam authentication failed after multiple attempts' });
              isConnecting = false;
              return;
            }

            if (globalEventSource) {
              globalEventSource.close();
              globalEventSource = null;
            }

            try {
              const token = await auth.access();

              // Create new EventSource connection
              globalEventSource = new EventSource(`${import.meta.env.VITE_API_URL}/steam/login`, {
                fetch: (input, init) =>
                  fetch(input, {
                    ...init,
                    headers: {
                      ...init?.headers,
                      'Authorization': `Bearer ${token}`,
                      'x-nestri-team': team().id
                    },
                  }),
              });

              globalEventSource.onopen = () => {
                console.log('Connected to Steam login stream');
                setIsConnected(true);
                globalReconnectAttempts = 0; // Reset reconnect counter on successful connection
                isConnecting = false;
              };

              // Set up event handlers for all specific events
              ['connected', 'challenge', 'completed'].forEach((eventType) => {
                globalEventSource!.addEventListener(eventType, (event) => {
                  try {
                    const data = JSON.parse(event.data);
                    console.log(`Received ${eventType} event:`, data);
                    notifyListeners(eventType, data);
                  } catch (error) {
                    console.error(`Error parsing ${eventType} event data:`, error);
                  }
                });
              });

              // Handle connection errors (this is different from server-sent 'error' events)
              globalEventSource.onerror = (error) => {
                console.error('Steam login stream connection error:', error);
                setIsConnected(false);

                // Close the connection to prevent automatic browser reconnect
                if (globalEventSource) {
                  globalEventSource.close();
                }

                // Check if we should attempt to reconnect
                if (globalReconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
                  const currentAttempt = globalReconnectAttempts + 1;
                  console.log(`Reconnecting (attempt ${currentAttempt}/${MAX_RECONNECT_ATTEMPTS})...`);
                  globalReconnectAttempts = currentAttempt;

                  // Exponential backoff for reconnection
                  const delay = Math.min(1000 * Math.pow(2, globalReconnectAttempts), 30000);
                  setTimeout(initConnection, delay);
                } else {
                  console.error(`Maximum reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached`);
                  // Notify listeners about connection failure
                  notifyListeners('error', { message: 'Connection to Steam authentication failed after multiple attempts' });
                  disconnect();
                  isConnecting = false;
                }
              };
            } catch (error) {
              console.error('Failed to connect to Steam login stream:', error);
              setIsConnected(false);
              isConnecting = false;
            }
          };

          // Disconnection function
          const disconnect = () => {
            if (globalEventSource) {
              globalEventSource.close();
              globalEventSource = null;
              setIsConnected(false);
              console.log('Disconnected from Steam login stream');

              // Clear all listeners
              Object.keys(listeners).forEach(key => {
                listeners[key] = [];
              });

              activeConnection = null;
            }
          };

          // Start the connection immediately
          await initConnection();

          // Create the connection interface
          const connection: SteamConnection = {
            addEventListener,
            removeEventListener,
            disconnect,
            isConnected: () => isConnected()
          };

          // Store the active connection
          activeConnection = connection;

          // Clean up on context destruction
          onCleanup(() => {
            // Instead of disconnecting on cleanup, we'll leave the connection
            // active for other components to use
            // Only disconnect if no components are using it
            if (!isConnected()) {
              disconnect();
            }
          });

          return connection;
        }
      }
    };

    return {
      client,
      ready: true
    };
  }
);