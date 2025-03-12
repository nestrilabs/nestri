import { email } from "./email";
import { allSecrets } from "./secret";
import { postgres } from "./postgres";

export const bus = new sst.aws.Bus("Bus");

bus.subscribe("Event", {
  // vpc,
  handler: "./packages/functions/src/event/event.handler",
  link: [
    postgres,
    email,
    ...allSecrets
  ],
  timeout: "5 minutes",
  permissions: [
    {
      actions: ["ses:SendEmail"],
      resources: ["*"],
    },
  ],
});