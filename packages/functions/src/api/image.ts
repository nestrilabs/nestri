import { z } from "zod"
import { Hono } from "hono";
import {
    S3Client,
    GetObjectCommand,
} from "@aws-sdk/client-s3";
import Sharp from "sharp";
import { Resource } from "sst";
import { validator } from "hono-openapi/zod";
import { HTTPException } from "hono/http-exception";

const s3 = new S3Client();

interface TimingMetrics {
    download: number;
    transform: number;
    upload?: number;
}

const formatTimingHeader = (metrics: TimingMetrics): string => {
    const timings = [
        `img-download;dur=${Math.round(metrics.download)}`,
        `img-transform;dur=${Math.round(metrics.transform)}`,
    ];

    if (metrics.upload !== undefined) {
        timings.push(`img-upload;dur=${Math.round(metrics.upload)}`);
    }

    return timings.join(",");
};


export namespace ImageApi {
    export const route = new Hono()
        .post("/:hash",
            validator("json",
                z.object({
                    dpr: z.number().optional(),
                    width: z.number().optional(),
                    height: z.number().optional(),
                    quality: z.number().optional(),
                    format: z.enum(["avif", "webp", "jpeg"]),
                })
            ),
            // validator("header",
            //     z.object({
            //         secretKey: z.string(),
            //     })
            // ),
            validator("param",
                z.object({
                    hash: z.string(),
                })
            ),
            async (c) => {
                const input = c.req.valid("json");
                const { hash } = c.req.valid("param");
                // const secret = c.req.valid("header").secretKey

                const metrics: TimingMetrics = {
                    download: 0,
                    transform: 0,
                };

                const downloadStart = performance.now();
                let originalImage: Buffer;
                let contentType: string;
                try {
                    const getCommand = new GetObjectCommand({
                        Bucket: Resource.Storage.name,
                        Key: hash,
                    });
                    const response = await s3.send(getCommand);

                    originalImage = Buffer.from(await response.Body!.transformToByteArray());
                    contentType = response.ContentType || "image/jpeg";
                    metrics.download = performance.now() - downloadStart;
                } catch (error) {
                    throw new HTTPException(500, { message: `Error downloading original image:${error}` });
                }


                const transformStart = performance.now();
                let transformedImage: Buffer;

                try {
                    let sharpInstance = Sharp(originalImage, {
                        failOn: "none",
                        animated: true,
                    });

                    const metadata = await sharpInstance.metadata();

                    // Apply transformations
                    if (input.width || input.height) {
                        sharpInstance = sharpInstance.resize({
                            width: input.width,
                            height: input.height,
                        });
                    }

                    if (metadata.orientation) {
                        sharpInstance = sharpInstance.rotate();
                    }

                    if (input.format) {
                        const isLossy = ["jpeg", "webp", "avif"].includes(input.format);

                        if (isLossy && input.quality) {
                            sharpInstance = sharpInstance.toFormat(input.format, {
                                quality: input.quality,
                            });
                        } else {
                            sharpInstance = sharpInstance.toFormat(input.format);
                        }
                    }

                    transformedImage = await sharpInstance.toBuffer();
                    metrics.transform = performance.now() - transformStart;

                    contentType = `image/${input.format}`;
                } catch (error) {
                    throw new HTTPException(500, { message: `Error transforming image:${error}` });
                }

                return c.newResponse(transformedImage,
                    200,
                    {
                        "Content-Type": contentType,
                        "Cache-Control": "max-age=31536000",
                        "Server-Timing": formatTimingHeader(metrics),
                    },
                )
            }
        )
}