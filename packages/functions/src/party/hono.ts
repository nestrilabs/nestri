import { Hono } from "hono";
import { logger } from "hono/logger";

const app = new Hono();

app
    .use(logger(), async (c, next) => {
        c.header("Cache-Control", "no-store");
        return next();
    })

app
  .get("/parties/main/:id", (c) => {
    const id = c.req.param();
    return c.text(`Hello there, ${id.id} 👋🏾`)
  })
  .notFound((c) => c.text("We could not find this route!"))

  export default app