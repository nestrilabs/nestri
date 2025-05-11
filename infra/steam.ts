import { vpc } from "./vpc";
import { postgres } from "./postgres";
import { allSecrets } from "./secret";

export const LibraryQueue = new sst.aws.Queue("LibraryQueue", {
    fifo: true,
    visibilityTimeout: "10 minutes",
});

LibraryQueue.subscribe({
    vpc,
    timeout:"10 minutes",
    handler: "packages/functions/src/queues/library.handler",
    link: [
        postgres,
        ...allSecrets
    ],
});