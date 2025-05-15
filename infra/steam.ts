import { vpc } from "./vpc";
import { postgres } from "./postgres";
import { steamEncryptionKey } from "./secret";

export const LibraryQueue = new sst.aws.Queue("LibraryQueue", {
    fifo: true,
    visibilityTimeout: "10 minutes",
});

LibraryQueue.subscribe({
    vpc,
    timeout: "10 minutes",
    memory: "3002 MB",
    handler: "packages/functions/src/queues/library.handler",
    link: [
        postgres,
        steamEncryptionKey
    ],
});