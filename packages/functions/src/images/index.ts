import { Hono } from "hono";
import { logger } from "hono/logger";
import { ImageRoute } from "./image";

const app = new Hono();
app
    .use(logger(), async (c, next) => {
        c.header("Cache-Control", "public, max-age=315360000, immutable");
        return next();
    })

const routes = app
    .get("/", (c) => c.text("Hello World 👋🏾"))
    .route("/image", ImageRoute.route)


export type Routes = typeof routes;
export default app;