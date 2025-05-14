import { vpc } from "./vpc";
import { storage } from "./storage";
// import { email } from "./email";
import { postgres } from "./postgres";
import { allSecrets } from "./secret";

export const bus = new sst.aws.Bus("Bus");

bus.subscribe("Event", {
  vpc,
  handler: "packages/functions/src/events/index.handler",
  link: [
    // email,
    postgres,
    storage,
    ...allSecrets
  ],
  timeout: "10 minutes",
  memory: "3002 MB",// For faster processing of large(r) images
  permissions: [
    {
      actions: ["ses:SendEmail"],
      resources: ["*"],
    },
  ],
});