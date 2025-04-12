import { Resource } from "sst";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";

export namespace Email {
  export const Client = new SESv2Client({});

  export async function send(
    from: string,
    to: string,
    subject: string,
    body: string,
  ) {
    from = from + "@" + Resource.Email.sender;
    console.log("sending email", subject, from, to);
    await Client.send(
      new SendEmailCommand({
        Destination: {
          ToAddresses: [to],
        },
        Content: {
          Simple: {
            Body: {
              Text: {
                Data: body,
              },
            },
            Subject: {
              Data: subject,
            },
          },
        },
        FromEmailAddress: `Nestri <${from}>`,
      }),
    );
  }
}