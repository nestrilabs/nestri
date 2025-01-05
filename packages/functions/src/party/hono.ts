import "zod-openapi/extend";
import { logger } from "hono/logger";
import { Hono } from "hono";
import { AuthApi } from "./auth";

const app = new Hono().basePath('/parties/main/:id');

app
  .use(logger(), async (c, next) => {
    c.header("Cache-Control", "no-store");
    return next();
  })

app
  .get("/",(c)=>c.text("Hello World 👋🏾"))
  .route("/auth", AuthApi.route)


export default app