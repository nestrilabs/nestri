import { vpc } from "./vpc";
import { secret } from "./secret";
import { storage } from "./storage";
import { postgres } from "./postgres";

export const dlq = new sst.aws.Queue("Dlq");

export const retryQueue = new sst.aws.Queue("RetryQueue");

export const bus = new sst.aws.Bus("Bus");

export const eventSub = bus.subscribe("Event", {
  vpc,
  handler: "packages/functions/src/events/index.handler",
  link: [
    // email,
    bus,
    storage,
    postgres,
    retryQueue,
    secret.PolarSecret,
    secret.SteamApiKey
  ],
  environment: {
    RETRIES: "2",
  },
  memory: "3002 MB",// For faster processing of large(r) images
  timeout: "10 minutes",
});

new aws.lambda.FunctionEventInvokeConfig("EventConfig", {
  functionName: $resolve([eventSub.nodes.function.name]).apply(
    ([name]) => name,
  ),
  maximumRetryAttempts: 1,
  destinationConfig: {
    onFailure: {
      destination: retryQueue.arn,
    },
  },
});

retryQueue.subscribe({
  vpc,
  handler: "packages/functions/src/queues/retry.handler",
  timeout: "30 seconds",
  environment: {
    RETRIER_QUEUE_URL: retryQueue.url,
  },
  link: [
    dlq,
    retryQueue,
    eventSub.nodes.function,
  ],
  permissions: [
    {
      actions: ["lambda:GetFunction", "lambda:InvokeFunction"],
      resources: [
        $interpolate`arn:aws:lambda:${aws.getRegionOutput().name}:${aws.getCallerIdentityOutput().accountId}:function:*`,
      ],
    },
  ],
  transform: {
    function: {
      deadLetterConfig: {
        targetArn: dlq.arn,
      },
    },
  },
});