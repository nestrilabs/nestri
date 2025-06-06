import { Hono } from "hono";
import { AwsClient } from 'aws4fetch'
import { Resource } from "sst";
import { HTTPException } from "hono/http-exception";


export namespace ImageRoute {
    export const route = new Hono()
        .get(
            "/:hashWithExt",
            async (c) => {
                // const { hashWithExt } = c.req.param();

                const client = new AwsClient({
                    accessKeyId: Resource.ImageInvokerAccessKey.key,
                    secretAccessKey: Resource.ImageInvokerAccessKey.secret,
                })

                const LAMBDA_URL = `https://lambda.us-east-1.amazonaws.com/2015-03-31/functions/${Resource.ImageProcessor.name}/invocations`

                const lambdaResponse = await client.fetch(LAMBDA_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ world: "hello" }),
                })

                if (!lambdaResponse.ok) {
                    console.error(await lambdaResponse.text())
                    return c.json({ error: `Lambda API returned ${lambdaResponse.status}` }, { status: 500 })
                }

                console.log(await lambdaResponse.json())

                // // Validate format
                // // Split hash and extension
                // const match = hashWithExt.match(/^([a-zA-Z0-9_-]+)\.(avif|webp)$/);
                // if (!match) {
                //     throw new HTTPException(400, { message: "Invalid image hash or format" });
                // }

                // const [, hash, format] = match;

                // const query = c.req.query();
                // // Parse dimensions
                // const width = parseInt(query.w || query.width || "");
                // const height = parseInt(query.h || query.height || "");
                // const dpr = parseFloat(query.dpr || "1");

                // if (isNaN(width) || width <= 0) {
                //     throw new HTTPException(400, { message: "Invalid width" });
                // }
                // if (!isNaN(height) && height < 0) {
                //     throw new HTTPException(400, { message: "Invalid height" });
                // }
                // if (dpr < 1 || dpr > 4) {
                //     throw new HTTPException(400, { message: "Invalid dpr" });
                // }

                // console.log("url",Resource.Api.url)

                // const imageBytes = await fetch(`${Resource.Api.url}/image/${hash}`,{
                //     method:"POST",
                //     body:JSON.stringify({   
                //         dpr,
                //         width,
                //         height,
                //         format
                //     })
                // })

                // console.log("imahe",imageBytes.headers)

                // // Normalize and build cache key
                // // const cacheKey = `${hash}_${format}_w${width}${height ? `_h${height}` : ""}_dpr${dpr}`;

                // // Add aggressive caching
                // // c.header("Cache-Control", "public, max-age=315360000, immutable");

                // // Placeholder image response (to be replaced by real logic)
                // return c.newResponse(await imageBytes.arrayBuffer(),
                //     // {
                //     //     headers: {
                //     //        ...imageBytes.headers
                //     //     }
                //     // }
                // );

                return c.text("success")
            }
        )
}