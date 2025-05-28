import { vpc } from "./vpc";
import { secret } from "./secret";
// import { email } from "./email";
import { storage } from "./storage";
import { postgres } from "./postgres";

export const bus = new sst.aws.Bus("Bus");

bus.subscribe("Event", {
  vpc,
  handler: "packages/functions/src/events/index.handler",
  link: [
    // email,
    bus,
    storage,
    postgres,
    secret.PolarSecret,
    secret.SteamApiKey
  ],
  timeout: "10 minutes",
  memory: "3002 MB",// For faster processing of large(r) images
  permissions: [
    {
      actions: ["ses:SendEmail","sqs:SendMessage"],
      resources: ["*"],
    },
  ],
  // transform: {
  //   function: {
  //     deadLetterConfig: {
  //       targetArn: EventDlq.arn,
  //     },
  //   },
  // },
});