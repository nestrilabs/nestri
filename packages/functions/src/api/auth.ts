import { Resource } from "sst";
import { subjects } from "../subjects";
import { Actor } from "@nestri/core/actor";
import { type MiddlewareHandler } from "hono";
import { createClient } from "@openauthjs/openauth/client";
import { ErrorCodes, VisibleError } from "@nestri/core/error";

const client = createClient({
  issuer: Resource.Auth.url,
  clientID: "api",
});

export const notPublic: MiddlewareHandler = async (c, next) => {
  if (!c.req.header("authorization"))
    throw new VisibleError(
      "authentication",
      ErrorCodes.Authentication.UNAUTHORIZED,
      "Missing authorization header",
    );

  Actor.userID();
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

  if (result.subject.type === "machine")
    return Actor.provide("machine", { ...result.subject.properties }, next)

  if (result.subject.type === "user") {
    const user = { ...result.subject.properties }
    const teamID = c.req.header("x-nestri-team");
    if (!teamID) {
      return Actor.provide("user", {
        ...user
      }, next);
    }
    return Actor.provide(
      "system",
      {
        teamID
      },
      async () =>
        Actor.provide("user", {
          ...user
        }, next)
    );
  }

  return Actor.provide("public", {}, next);
};