import { email } from "./email";
import { allSecrets } from "./secret";
import { database } from "./database";

export const bus = new sst.aws.Bus("Bus");

bus.subscribe("Event", {
  handler: "./packages/functions/src/event/event.handler",
  link: [
    database,
    email,
    ...allSecrets],
  timeout: "5 minutes",
  permissions: [
    {
      actions: ["ses:SendEmail"],
      resources: ["*"],
    },
  ],
});