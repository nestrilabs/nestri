import { setup } from "actor-core";
import chatRoom from "./actor-core";
import { createRouter } from "@actor-core/bun";
import {
    FileSystemGlobalState,
    FileSystemActorDriver,
    FileSystemManagerDriver,
} from "@actor-core/file-system";

export namespace Realtime {
    const app = setup({
        actors: { chatRoom },
        basePath: "/realtime"
    });

    const fsState = new FileSystemGlobalState("/tmp");

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