import { setup } from "actor-core";
import { counter } from "./counter";
import { createRouter } from "@actor-core/bun";

export namespace Realtime {
    export const app = setup({
        actors: { counter },
        basePath: "/realtime",
        cors: { origin: "*" }
    });

    export type App = typeof app

    const realtimeRouter = createRouter(app);

    export const route = realtimeRouter.router;
    export const webSocketHandler = realtimeRouter.webSocketHandler;
}