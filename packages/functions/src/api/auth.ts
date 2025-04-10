import { Resource } from "sst";
import { subjects } from "../subjects";
import { type MiddlewareHandler } from "hono";
import { VisibleError } from "@nestri/core/error";
import { ActorContext } from "@nestri/core/actor";
import { HTTPException } from "hono/http-exception";
import { useActor, withActor } from "@nestri/core/actor";
import { createClient } from "@openauthjs/openauth/client";
import { ErrorCodes, VisibleError } from "@nestri/core/error";

const client = createClient({
  clientID: "api",
  issuer: Resource.Urls.auth
});



export const notPublic: MiddlewareHandler = async (c, next) => {
  const actor = useActor();
  if (actor.type === "public")
    throw new VisibleError(
      "authentication",
      ErrorCodes.Authentication.UNAUTHORIZED,
      "Missing authorization header",
    );
  return next();
};

export const auth: MiddlewareHandler = async (c, next) => {
  const authHeader =
    c.req.query("authorization") ?? c.req.header("authorization");
  if (!authHeader) return next();
  const match = authHeader.match(/^Bearer (.+)$/);
  if (!match) {
    throw new VisibleError(
      "authentication",
      ErrorCodes.Authentication.INVALID_TOKEN,
      "Invalid personal access token",
    );
  }
  const bearerToken = match[1];
  let result = await client.verify(subjects, bearerToken!);
  if (result.err) {
    throw new VisibleError(
      "authentication",
      ErrorCodes.Authentication.INVALID_TOKEN,
      "Invalid bearer token",
    );
  }
    
    if (result.subject.type === "machine") {
      console.log("machine detected")
      return withActor(result.subject, next);
    }

    if (result.subject.type === "user") {
      const teamID = c.req.header("x-nestri-team") //|| c.req.query("teamID");
      if (!teamID) return withActor(result.subject, next);
      // const email = result.subject.properties.email;
      return withActor(
        {
          type: "system",
          properties: {
            teamID,
          },
        },
      },
      next
      //   async () => {
      //     const user = await User.fromEmail(email);
      //     if (!user || user.length === 0) {
      //       c.status(401);
      //       return c.text("Unauthorized");
      //     }
      //     return withActor(
      //       {
      //         type: "member",
      //         properties: { userID: user[0].id, workspaceID: user.workspaceID },
      //       },
      //       next,
      //     );
      //   },
    );
  }
  return ActorContext.with({ type: "public", properties: {} }, next);
};