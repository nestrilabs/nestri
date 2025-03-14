import {z} from "zod"
import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";
import { issuer } from "@openauthjs/openauth";
import { handle } from "hono/aws-lambda";
import { subjects } from "./subjects";
import { CodeProvider } from "@openauthjs/openauth/provider/code";
import { Resource } from "sst";

const ses = new SESv2Client({});

export const handler = handle(
    issuer({
      subjects,
      providers: {
        email: CodeProvider({
          async request(req, state, form, error) {
            console.log(state);
            const params = new URLSearchParams();
            if (error) {
              params.set("error", error.type);
            }
            if (state.type === "start") {
              return Response.redirect(
                process.env.AUTH_FRONTEND_URL +
                  "/auth/email?" +
                  params.toString(),
                302,
              );
            }
  
            if (state.type === "code") {
              return Response.redirect(
                process.env.AUTH_FRONTEND_URL + "/auth/code?" + params.toString(),
                302,
              );
            }
  
            return new Response("ok");
          },
          async sendCode(claims, code) {
            const email = z.string().email().parse(claims.email);
            const cmd = new SendEmailCommand({
              Destination: {
                ToAddresses: [email],
              },
              FromEmailAddress: `SST <auth@${Resource.Mail.sender}>`,
              Content: {
                Simple: {
                  Body: {
                    Html: {
                      Data: `Your pin code is <strong>${code}</strong>`,
                    },
                    Text: {
                      Data: `Your pin code is ${code}`,
                    },
                  },
                  Subject: {
                    Data: "SST Console Pin Code: " + code,
                  },
                },
              },
            });
            await ses.send(cmd);
          },
        }),
      },
      async success(ctx, response) {
        let email: string | undefined;
        console.log(response);
        // if (response.provider === "email") {
        //   email = response.claims.email;
  
        //   if (response.claims.impersonate) {
        //     if (response.claims.email?.split("@")[1] !== "sst.dev") {
        //       return new Response("Unauthorized", {
        //         status: 401,
        //       });
        //     }
        //     email = await db
        //       .select({
        //         email: user.email,
        //       })
        //       .from(user)
        //       .innerJoin(workspace, eq(user.workspaceID, workspace.id))
        //       .where(
        //         and(
        //           eq(workspace.slug, response.claims.impersonate),
        //           isNull(workspace.timeDeleted),
        //           isNull(user.timeDeleted),
        //         ),
        //       )
        //       .then((rows) => rows.at(0)?.email);
        //   }
        // }
        // if (!email) throw new Error("No email found");
        // let accountID = await Account.fromEmail(email).then((x) => x?.id);
        // if (!accountID) {
        //   console.log("creating account for", email);
        //   accountID = await Account.create({
        //     email: email!,
        //   });
        // }
        return ctx.subject(
          "user",
          {
            userID: "usr_XXXXXXXX",
            email: email!,
          },
          {
            subject: email!,
          },
        );
      },
    }),
  );