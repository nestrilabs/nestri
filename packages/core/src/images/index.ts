import { z } from "zod";
import { fn } from "../utils";
import { Examples } from "../examples";
import { createSelectSchema } from "drizzle-zod";
import { createTransaction } from "../drizzle/transaction";
import { ImageColor, ImageDimensions, imagesTable } from "./images.sql";

export namespace Images {
    const Image = z.object({
        hash: z.string().openapi({
            description: "A unique cryptographic hash identifier for the image, used for deduplication and URL generation",
            example: Examples.CommonImg[0].hash
        }),
        averageColor: ImageColor.openapi({
            description: "The calculated dominant color of the image with light/dark classification, used for UI theming",
            example: Examples.CommonImg[0].averageColor
        }),
        dimensions: ImageDimensions.openapi({
            description: "The width and height dimensions of the image in pixels",
            example: Examples.CommonImg[0].dimensions
        }),
        fileSize: z.number().int().openapi({
            description: "The size of the image file in bytes, used for storage and bandwidth calculations",
            example: Examples.CommonImg[0].fileSize
        })
    })

    export const Info = z.object({
        screenshots: Image.array().openapi({
            description: "In-game captured images showing actual gameplay, user interface, and key moments",
            example: Examples.Images.screenshots
        }),
        boxArts: Image.array().openapi({
            description: "Square 1:1 aspect ratio artwork, typically used for store listings and thumbnails",
            example: Examples.Images.boxArts
        }),
        posters: Image.array().openapi({
            description: "Vertical 2:3 aspect ratio promotional artwork, similar to movie posters",
            example: Examples.Images.posters
        }),
        banners: Image.array().openapi({
            description: "Horizontal promotional artwork optimized for header displays and banners",
            example: Examples.Images.banners
        }),
        heroArts: Image.array().openapi({
            description: "High-resolution, wide-format artwork designed for featured content and main entries",
            example: Examples.Images.heroArts
        }),
        backdrops: Image.array().openapi({
            description: "Full-width backdrop images optimized for page layouts and decorative purposes",
            example: Examples.Images.backdrops
        }),
        logos: Image.array().openapi({
            description: "Official game logo artwork, typically with transparent backgrounds for flexible placement",
            example: Examples.Images.logos
        }),
        icons: Image.array().openapi({
            description: "Small-format identifiers used for application shortcuts and compact displays",
            example: Examples.Images.icons
        }),
    }).openapi({
        ref: "Images",
        description: "Complete collection of game-related visual assets, including promotional materials, UI elements, and store assets",
        example: Examples.Images
    })

    export type Info = z.infer<typeof Info>

    export const InputInfo = createSelectSchema(imagesTable)
        .omit({ timeCreated: true, timeDeleted: true, timeUpdated: true })

    export const create = fn(
        InputInfo,
        (input) =>
            createTransaction(async (tx) =>
                tx
                    .insert(imagesTable)
                    .values(input)
                    .onConflictDoUpdate({
                        target: [imagesTable.imageHash, imagesTable.type, imagesTable.baseGameID, imagesTable.position],
                        set: { timeDeleted: null }
                    })
            )
    )

    export function serialize(
        input: typeof imagesTable.$inferSelect[],
    ): z.infer<typeof Info> {
        return input
            .sort((a, b) => {
                if (a.type === b.type) {
                    return a.position - b.position;
                }
                return a.type.localeCompare(b.type);
            })
            .reduce<Record<`${typeof imagesTable.$inferSelect["type"]}s`, { hash: string; averageColor: ImageColor; dimensions: ImageDimensions; fileSize: number }[]>>((acc, img) => {
                const key = `${img.type}s` as `${typeof img.type}s`
                if (Array.isArray(acc[key])) {
                    acc[key]!.push({
                        hash: img.imageHash,
                        averageColor: img.extractedColor,
                        dimensions: img.dimensions,
                        fileSize: img.fileSize
                    })
                }
                return acc
            }, {
                screenshots: [],
                boxArts: [],
                banners: [],
                heroArts: [],
                posters: [],
                backdrops: [],
                icons: [],
                logos: [],
            })
    }

}