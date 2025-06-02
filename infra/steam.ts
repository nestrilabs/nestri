import { bus } from "./bus";
import { vpc } from "./vpc";
import { secret } from "./secret";
import { postgres } from "./postgres";

export const libraryDlq = new sst.aws.Queue("LibraryDLQ");

export const libraryQueue = new sst.aws.Queue("LibraryQueue", {
    dlq: libraryDlq.arn,
    visibilityTimeout: "5 minutes",
});

libraryQueue.subscribe({
    vpc,
    memory: "3002 MB",
    timeout: "5 minutes",
    handler: "packages/functions/src/queues/library.handler",
    link: [
        bus,
        postgres,
        secret.SteamApiKey
    ],
    permissions: [
        {
            actions: ["sqs:SendMessage"],
            resources: ["*"],
        },
    ],
});