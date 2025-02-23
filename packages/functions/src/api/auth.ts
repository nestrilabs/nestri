import { Resource } from "sst";
import { subjects } from "../subjects";
import { type MiddlewareHandler } from "hono";
// import { User } from "@nestri/core/user/index";
import { VisibleError } from "@nestri/core/error";
import { HTTPException } from "hono/http-exception";
import { useActor, withActor } from "@nestri/core/actor";
import { createClient } from "@openauthjs/openauth/client";

const client = createClient({
  issuer: Resource.Urls.auth,
  clientID: "api",
});

export const notPublic: MiddlewareHandler = async (c, next) => {
  const actor = useActor();
  if (actor.type === "public")
    throw new HTTPException(401, { message: "Unauthorized" });
  return next();
};

export const auth: MiddlewareHandler = async (c, next) => {
  const authHeader =
    c.req.query("authorization") ?? c.req.header("authorization");
  if (!authHeader) return next();
  const match = authHeader.match(/^Bearer (.+)$/);
  if (!match) {
    throw new VisibleError(
      "auth.token",
      "Bearer token not found or improperly formatted",
    );
  }
  const bearerToken = match[1];
  let result = await client.verify(subjects, bearerToken!);
  if (result.err) {
    throw new HTTPException(401, {
      message: "Unauthorized",
    });
  }

  if (result.subject.type === "user") {
    const teamID =
      c.req.header("x-nestri-team") || c.req.query("teamID");
    if (!teamID) return withActor(result.subject, next);
    // const email = result.subject.properties.email;
    return withActor(
      {
        type: "system",
        properties: {
          teamID,
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
};