import { Resource } from "sst";
import { subjects } from "../../subjects";
import { Actor } from "@nestri/core/actor";
import { type MiddlewareHandler } from "hono";
import { createClient } from "@openauthjs/openauth/client";
import { ErrorCodes, VisibleError } from "@nestri/core/error";
import { Member } from "@nestri/core/member/index";

const client = createClient({
  clientID: "api",
  issuer: Resource.Auth.url,
});

export const notPublic: MiddlewareHandler = async (c, next) => {
  const actor = Actor.use();
  if (actor.type === "public")
    throw new VisibleError(
      "authentication",
      ErrorCodes.Authentication.UNAUTHORIZED,
      "Missing authorization header",
    );
  return next();
};

export const auth: MiddlewareHandler = async (c, next) => {
  const authHeader = c.req.header("authorization");
  if (!authHeader) return Actor.provide("public", {}, next);
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

  if (result.subject.type === "user") {
    const teamID = c.req.header("x-nestri-team");
    if (!teamID) {
      return Actor.provide(result.subject.type, result.subject.properties, next);
    }
    const userID = result.subject.properties.userID
    return Actor.provide(
      "system",
      {
        teamID
      },
      async () => {
        const member = await Member.fromUserID(userID)
        if (!member || !member.userID) {
          throw new VisibleError(
            "authentication",
            ErrorCodes.Authentication.UNAUTHORIZED,
            `You don't have permission to access this resource.`
          )
        }
        return Actor.provide(
          "member",
          {
            steamID: member.steamID,
            userID: member.userID,
            teamID: member.teamID
          },
          next)
      });
  }

  return Actor.provide("public", {}, next);
};