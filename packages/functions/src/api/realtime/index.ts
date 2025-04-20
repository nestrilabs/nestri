import { steam } from "./steam";
import { setup } from "actor-core";
import { createRouter } from "@actor-core/bun";
import { FileSystemManagerDriver, FileSystemActorDriver, FileSystemGlobalState } from "@actor-core/file-system";

export namespace Realtime {
    export const app = setup({
        actors: { steam },
        basePath: "/realtime",
        cors: { origin: "*" }
    });

    const fsState = new FileSystemGlobalState("/tmp");

    export type App = typeof app

    const realtimeRouter = createRouter(app, {
        topology: "standalone",
        drivers: {
            manager: new FileSystemManagerDriver(app, fsState),
            actor: new FileSystemActorDriver(fsState),
        }
    });

    export const route = realtimeRouter.router;
    export const webSocketHandler = realtimeRouter.webSocketHandler;
}