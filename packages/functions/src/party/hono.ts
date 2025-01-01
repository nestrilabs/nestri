import "zod-openapi/extend";
import type * as Party from "partykit/server";
// import { Resource } from "sst";
import { ZodError } from "zod";
import { logger } from "hono/logger";
// import { subjects } from "../subjects";
import { VisibleError } from "../error";
// import { ActorContext } from '@nestri/core/actor';
import { Hono, type MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { AuthApi } from "./auth";


const app = new Hono().basePath('/parties/main/:id');
// const auth: MiddlewareHandler = async (c, next) => {
// const client = createClient({
//   clientID: "api",
//   issuer: "http://auth.nestri.io" //Resource.Urls.auth
// });

// const authHeader =
//   c.req.query("authorization") ?? c.req.header("authorization");
// if (authHeader) {
//   const match = authHeader.match(/^Bearer (.+)$/);
//   if (!match || !match[1]) {
//     throw new VisibleError(
//       "input",
//       "auth.token",
//       "Bearer token not found or improperly formatted",
//     );
//   }
// const bearerToken = match[1];

// const result = await client.verify(subjects, bearerToken!);
// if (result.err)
//   throw new VisibleError("input", "auth.invalid", "Invalid bearer token");
// if (result.subject.type === "user") {
//   // return ActorContext.with(
//   //   {
//   //     type: "user",
//   //     properties: {
//   //       accessToken: result.subject.properties.accessToken,
//   //       userID: result.subject.properties.userID,
//   //       auth: {
//   //         type: "oauth",
//   //         clientID: result.aud,
//   //       },
//   //     },
//   //   },
//   //   next,
//   // );
// }
//   }
// }

app
  .use(logger(), async (c, next) => {
    c.header("Cache-Control", "no-store");
    return next();
  })
// .use(auth)


app
  .route("/auth", AuthApi.route)
  // .get("/parties/main/:id", (c) => {
  //   const id = c.req.param();
  //   const env = c.env as any
  //   const party = env.room as Party.Room
  //   party.broadcast("hello from hono")

  //   return c.text(`Hello there, ${id.id} 👋🏾`)
  // })
  .onError((error, c) => {
    console.error(error);
    if (error instanceof VisibleError) {
      return c.json(
        {
          code: error.code,
          message: error.message,
        },
        error.kind === "auth" ? 401 : 400,
      );
    }
    if (error instanceof ZodError) {
      const e = error.errors[0];
      if (e) {
        return c.json(
          {
            code: e?.code,
            message: e?.message,
          },
          400,
        );
      }
    }
    if (error instanceof HTTPException) {
      return c.json(
        {
          code: "request",
          message: "Invalid request",
        },
        400,
      );
    }
    return c.json(
      {
        code: "internal",
        message: "Internal server error",
      },
      500,
    );
  });


export default app