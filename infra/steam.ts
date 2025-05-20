import { bus } from "./bus";
import { vpc } from "./vpc";
import { secret } from "./secret";
import { postgres } from "./postgres";

export const LibraryQueue = new sst.aws.Queue("LibraryQueue", {
    fifo: true,
    visibilityTimeout: "10 minutes",
});

LibraryQueue.subscribe({
    vpc,
    memory: "3002 MB",
    timeout: "10 minutes",
    handler: "packages/functions/src/queues/library.handler",
    link: [
        bus,
        postgres,
        secret.SteamApiKey,
        secret.PolarSecret
    ],
});