import { hc } from "hono/client";
import { useSteam } from "./context";
import { useOpenAuth } from "@openauthjs/solid";
import { type app } from "@nestri/functions/api/index";
import { createInitializedContext } from "@nestri/www/common/context";


export const { use: useApi, provider: ApiProvider } = createInitializedContext(
    "ApiContext",
    () => {
        const steam = useSteam();
        const auth = useOpenAuth();

        const client = hc<typeof app>(import.meta.env.VITE_API_URL, {
            async fetch(...args: Parameters<typeof fetch>): Promise<Response> {
                const [input, init] = args;
                const request =
                    input instanceof Request ? input : new Request(input, init);
                const headers = new Headers(request.headers);
                headers.set("authorization", `Bearer ${await auth.access()}`);
                headers.set("x-nestri-steam", steam().id);

                return fetch(
                    new Request(request, {
                        ...init,
                        headers,
                    }),
                );
            },
        });
        return {
            client,
            ready: true,
        };
    },
);