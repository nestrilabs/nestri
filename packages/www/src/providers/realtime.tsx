import { createClient } from "actor-core/client";
import { Realtime } from "@nestri/functions/api/realtime/index";
import { createInitializedContext } from "@nestri/www/common/context";

export const { use: useRealtime, provider: RealtimeProvider } = createInitializedContext(
    "RealtimeContext",
    () => {
        const client = createClient<Realtime.App>(`${import.meta.env.VITE_API_URL}/realtime`);

        return {
            client,
            ready: true
        };
    },
);