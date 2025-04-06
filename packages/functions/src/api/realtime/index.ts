import { setup } from "actor-core";
import chatRoom from "./actor-core";
import { createRouter } from "@actor-core/bun";

export namespace Realtime {
    const app = setup({
        actors: { chatRoom },
        basePath: "/realtime"
    });

    const realtimeRouter = createRouter(app);

    export const route = realtimeRouter.router;
    export const webSocketHandler = realtimeRouter.webSocketHandler;
}