import { useTeam } from "./context";
import { useOpenAuth } from "@openauthjs/solid";
import { createSignal, onCleanup } from "solid-js";
import { createInitializedContext } from "../common/context";

// Type definitions
interface SteamContext {
    ready: boolean;
    client: {
        // Regular API endpoints
        whoami: () => Promise<any>;
        games: () => Promise<any>;
        // SSE connection for login
        loginStream: {
            connect: () => void;
            disconnect: () => void;
            isConnected: () => boolean;
            loginUrl: () => string | null;
        };
    };
}

// Create the initialized context
export const { use: useSteam, provider: SteamProvider } = createInitializedContext(
    "Steam",
    () => {
        const team = useTeam();
        const auth = useOpenAuth();
        const [loginUrl, setLoginUrl] = createSignal<string | null>(null);
        const [isConnected, setIsConnected] = createSignal(false);
        let eventSource: EventSource | null = null;

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

            // SSE connection for login
            loginStream: {
                connect: async () => {
                    if (eventSource) {
                        eventSource.close();
                    }

                    try {
                        const token = await auth.access();
                        // Create the URL with the token as a query parameter
                        const sseUrl = new URL(`${import.meta.env.VITE_STEAM_URL}/login`);
                        sseUrl.searchParams.append('token', token!);
                        sseUrl.searchParams.append('team', team().id);

                        eventSource = new EventSource(sseUrl.toString());

                        eventSource.onopen = () => {
                            console.log('Connected to Steam login stream');
                            setIsConnected(true);
                        };

                        eventSource.onmessage = (event) => {
                            // The data is expected to be a simple URL string
                            setLoginUrl(event.data);
                            console.log('Received login URL:', event.data);
                        };

                        eventSource.onerror = (error) => {
                            console.error('Steam login stream error:', error);
                            setIsConnected(false);
                            // Attempt to reconnect after a delay
                            setTimeout(client.loginStream.connect, 5000);
                        };
                    } catch (error) {
                        console.error('Failed to connect to Steam login stream:', error);
                        setIsConnected(false);
                    }
                },

                disconnect: () => {
                    if (eventSource) {
                        eventSource.close();
                        eventSource = null;
                        setIsConnected(false);
                        setLoginUrl(null);
                        console.log('Disconnected from Steam login stream');
                    }
                },

                isConnected: () => isConnected(),

                loginUrl: () => loginUrl()
            }
        };

        // Clean up on context destruction
        onCleanup(() => {
            client.loginStream.disconnect();
        });

        return {
            client,
            ready: true
        };
    }
);