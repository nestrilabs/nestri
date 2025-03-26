import { useTeam } from "./context";
import { EventSource } from 'eventsource'
import { useOpenAuth } from "@openauthjs/solid";
import { createSignal, onCleanup } from "solid-js";
import { createInitializedContext } from "../common/context";

// Type definitions for the events
interface SteamEventTypes {
  'url': string;
  'login-attempt': { username: string };
  'login-success': { username: string; steamId: string };
  'login-unsuccessful': { error: string };
  'logged-off': { reason: string };
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
    // Regular API endpoints
    whoami: () => Promise<any>;
    games: () => Promise<any>;
    // SSE connection for login
    login: {
      connect: () => SteamConnection;
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
      // Regular HTTP endpoints
      whoami: async () => {
        const token = await auth.access();
        const response = await fetch(`${import.meta.env.VITE_STEAM_URL}/whoami`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'x-nestri-team': team().id
          }
        });
        return response.json();
      },

      games: async () => {
        const token = await auth.access();
        const response = await fetch(`${import.meta.env.VITE_STEAM_URL}/games`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'x-nestri-team': team().id
          }
        });
        return response.json();
      },

      // SSE connection factory for login
      login: {
        connect: async (): Promise<SteamConnection> => {
          let eventSource: EventSource | null = null;
          const [isConnected, setIsConnected] = createSignal(false);
          
          // Store event listeners
          const listeners: Record<string, Array<(data: any) => void>> = {
            'url': [],
            'login-attempt': [],
            'login-success': [],
            'login-unsuccessful': [],
            'logged-off': []
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

          // Initialize connection
          const initConnection = async () => {
            if (eventSource) {
              eventSource.close();
            }

            try {
              const token = await auth.access();

              eventSource = new EventSource(`${import.meta.env.VITE_STEAM_URL}/login`, {
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
              };

              // Set up event handlers for all specific events
              ['url', 'login-attempt', 'login-success', 'login-unsuccessful', 'logged-off'].forEach((eventType) => {
                eventSource!.addEventListener(eventType, (event) => {
                  try {
                    const data = JSON.parse(event.data);
                    console.log(`Received ${eventType} event:`, data);
                    
                    // Notify all registered listeners for this event type
                    if (listeners[eventType]) {
                      listeners[eventType].forEach(callback => {
                        callback(data);
                      });
                    }
                  } catch (error) {
                    console.error(`Error parsing ${eventType} event data:`, error);
                  }
                });
              });

              // Handle generic messages (fallback)
              eventSource.onmessage = (event) => {
                console.log('Received generic message:', event.data);
              };

              eventSource.onerror = (error) => {
                console.error('Steam login stream error:', error);
                setIsConnected(false);
                // Attempt to reconnect after a delay
                setTimeout(initConnection, 5000);
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