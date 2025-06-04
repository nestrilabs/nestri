import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { Resource } from "sst";

export namespace ImageRoute {
    export const route = new Hono()
        .get(
            "/:hashWithExt",
            (c) => {
                const { hashWithExt } = c.req.param();

                // Validate format
                // Split hash and extension
                const match = hashWithExt.match(/^([a-zA-Z0-9_-]+)\.(avif|webp)$/);
                if (!match) {
                    throw new HTTPException(400, { message: "Invalid image hash or format" });
                }

                const [, hash, format] = match;

                const query = c.req.query();
                // Parse dimensions
                const width = parseInt(query.w || query.width || "");
                const height = parseInt(query.h || query.height || "");
                const dpr = parseFloat(query.dpr || "1");

                if (isNaN(width) || width <= 0) {
                    throw new HTTPException(400, { message: "Invalid width" });
                }
                if (!isNaN(height) && height < 0) {
                    throw new HTTPException(400, { message: "Invalid height" });
                }
                if (dpr < 1 || dpr > 4) {
                    throw new HTTPException(400, { message: "Invalid dpr" });
                }

                const image = `${Resource.ImageRouter.url}/images/00641801e0f80a82bbbbf9dec5593cd7cbe2a5eec45d36199a5c14ed30d8df66`


                // Normalize and build cache key
                const cacheKey = `${hash}_${format}_w${width}${height ? `_h${height}` : ""}_dpr${dpr}`;

                // Add aggressive caching
                c.header("Cache-Control", "public, max-age=315360000, immutable");

                // Placeholder image response (to be replaced by real logic)
                return c.text(`Would serve image: ${cacheKey}`);
            }
        )
}