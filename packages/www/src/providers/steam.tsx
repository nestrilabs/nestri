import { useTeam } from "./context";
import { EventSource } from 'eventsource'
import { useOpenAuth } from "@openauthjs/solid";
import { createSignal, onCleanup } from "solid-js";
import { createInitializedContext } from "../common/context";

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
          let eventSource: EventSource | null = null;
          const [isConnected, setIsConnected] = createSignal(false);
          // Track reconnection attempts
          const [reconnectAttempts, setReconnectAttempts] = createSignal(0);
          const MAX_RECONNECT_ATTEMPTS = 5;

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
            if (eventSource) {
              eventSource.close();
            }

            try {
              const token = await auth.access();

              // Create new EventSource connection
              eventSource = new EventSource(`${import.meta.env.VITE_API_URL}/steam/login`, {
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

              eventSource.onopen = () => {
                console.log('Connected to Steam login stream');
                setIsConnected(true);
                setReconnectAttempts(0); // Reset reconnect counter on successful connection
              };

              // Set up event handlers for all specific events
              ['connected', 'challenge', 'completed'].forEach((eventType) => {
                eventSource!.addEventListener(eventType, (event) => {
                  try {
                    const data = JSON.parse(event.data);
                    console.log(`Received ${eventType} event:`, data);
                    notifyListeners(eventType, data);
                  } catch (error) {
                    console.error(`Error parsing ${eventType} event data:`, error);
                  }
                });
              });

              // // Special handling for error events from the server (not connection errors)
              // eventSource.addEventListener('error', (event) => {
              //   try {
              //     // Only try to parse if there's actual data
              //     if (event.) {
              //       const data = JSON.parse(event.data);
              //       console.log(`Received error event:`, data);
              //       notifyListeners('error', data);
              //     }
              //   } catch (error) {
              //     console.error(`Error parsing error event data:`, error);
              //     // Don't try to reconnect for JSON parsing errors
              //   }
              // });

              // Handle connection errors (this is different from server-sent 'error' events)
              eventSource.onerror = (error) => {
                console.error('Steam login stream connection error:', error);
                setIsConnected(false);

                // Check if we should attempt to reconnect
                const attempts = reconnectAttempts();
                if (attempts < MAX_RECONNECT_ATTEMPTS) {
                  console.log(`Reconnecting (attempt ${attempts + 1}/${MAX_RECONNECT_ATTEMPTS})...`);
                  setReconnectAttempts(attempts + 1);

                  // Exponential backoff for reconnection
                  const delay = Math.min(1000 * Math.pow(2, attempts), 30000);
                  setTimeout(initConnection, delay);
                } else {
                  console.error(`Maximum reconnection attempts (${MAX_RECONNECT_ATTEMPTS}) reached`);
                  // Notify listeners about connection failure
                  notifyListeners('error', { message: 'Connection to Steam authentication failed after multiple attempts' });
                }
              };
            } catch (error) {
              console.error('Failed to connect to Steam login stream:', error);
              setIsConnected(false);
            }
          };

          // Disconnection function
          const disconnect = () => {
            if (eventSource) {
              eventSource.close();
              eventSource = null;
              setIsConnected(false);
              console.log('Disconnected from Steam login stream');

              // Clear all listeners
              Object.keys(listeners).forEach(key => {
                listeners[key] = [];
              });
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

          // Clean up on context destruction
          onCleanup(() => {
            disconnect();
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