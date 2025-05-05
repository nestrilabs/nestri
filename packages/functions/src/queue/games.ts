import type { User } from "@nestri/core/user/index";
import type { SQSHandler } from "aws-lambda";

export const handler: SQSHandler = async(event)=>{
    for (const record of event.Records) {
        const parsed = JSON.parse(
          record.body,
        ) as typeof User.Events.Created.$payload;
        await withActor(parsed.metadata.actor, async () => {
          await Issue.Send.triggerIssue(parsed.properties);
        });
      }
}