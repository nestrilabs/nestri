import { useTeam } from "./context";
import { useAccount } from "./account";
import { useOpenAuth } from "@openauthjs/solid";
import { createEffect, createSignal } from "solid-js";
import { Realtime } from "@nestri/functions/api/realtime/index";
import { ChatRoom } from "@nestri/functions/api/realtime/actor-core";
import { createInitializedContext } from "@nestri/www/common/context";
import { ActorHandle, type AnyActorDefinition, type createClient } from "actor-core/client";

export const { use: useRealtime, provider: RealtimeProvider } = createInitializedContext(
    "RealtimeContext",
    () => {
        const team = useTeam();
        const auth = useOpenAuth();
        const account = useAccount();
        //@ts-expect-error
        const [client, setClient] = createSignal<ActorHandle<typeof ChatRoom> | null>(null);
        
        createEffect(async () => {    
            const accessToken = await auth.access();
            //@ts-expect-error
            const newClient = createClient<Realtime.Info>(`${import.meta.env.VITE_API_URL}/realtime`,);

            //@ts-expect-error
            const actor = await newClient.get<typeof ChatRoom>(account.current.id, {
                params: {
                    authToken: accessToken,
                },
                create: {
                    tags: {
                        userID: account.current.id,
                        teamID: team().id
                    }
                }
            });
            setClient(actor);
        });

        return {
            get client() { return client() },
            get ready() { return !!client() },
        };
    },
);