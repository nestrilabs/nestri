import { z } from "zod";
import { fn } from "../utils";
import { Resource } from "sst";
import { bus } from "sst/aws/bus";
import { Client } from "../client";
import { Common } from "../common";
import { Examples } from "../examples";
import { createEvent } from "../event";
import { eq, isNull, and } from "drizzle-orm";
import { ImageTypeEnum } from "../images/images.sql";
import { afterTx, createTransaction, useTransaction } from "../drizzle/transaction";
import { CompatibilityEnum, baseGamesTable, Size, ControllerEnum } from "./base-game.sql";

export namespace BaseGame {
    export const Info = z.object({
        id: z.string().openapi({
            description: Common.IdDescription,
            example: Examples.BaseGame.id
        }),
        slug: z.string().openapi({
            description: "A URL-friendly unique identifier for the game, used in web addresses and API endpoints",
            example: Examples.BaseGame.slug
        }),
        name: z.string().openapi({
            description: "The official title of the game as listed on Steam",
            example: Examples.BaseGame.name
        }),
        size: Size.openapi({
            description: "Storage requirements in bytes: downloadSize represents the compressed download, and sizeOnDisk represents the installed size",
            example: Examples.BaseGame.size
        }),
        releaseDate: z.date().openapi({
            description: "The initial public release date of the game on Steam",
            example: Examples.BaseGame.releaseDate
        }),
        description: z.string().openapi({
            description: "A comprehensive overview of the game, including its features, storyline, and gameplay elements",
            example: Examples.BaseGame.description
        }),
        score: z.number().openapi({
            description: "The aggregate user review score on Steam, represented as a percentage of positive reviews",
            example: Examples.BaseGame.score
        }),
        primaryGenre: z.string().nullable().openapi({
            description: "The main category or genre that best represents the game's content and gameplay style",
            example: Examples.BaseGame.primaryGenre
        }),
        controllerSupport: z.enum(ControllerEnum.enumValues).openapi({
            description: "Indicates the level of gamepad/controller compatibility: 'Full', 'Partial', or 'Unkown' for no support",
            example: Examples.BaseGame.controllerSupport
        }),
        compatibility: z.enum(CompatibilityEnum.enumValues).openapi({
            description: "Steam Deck/Proton compatibility rating indicating how well the game runs on Linux systems",
            example: Examples.BaseGame.compatibility
        })
    }).openapi({
        ref: "BaseGame",
        description: "Detailed information about a game available in the Nestri library, including technical specifications and metadata",
        example: Examples.BaseGame
    })

    export type Info = z.infer<typeof Info>;

    export const Events = {
        New: createEvent(
            "new_image.save",
            z.object({
                appID: Info.shape.id,
                url: z.string().url(),
                type: z.enum(ImageTypeEnum.enumValues)
            }),
        ),
        NewBoxArt: createEvent(
            "new_box_art_image.save",
            z.object({
                appID: Info.shape.id,
                logoUrl: z.string().url(),
                backgroundUrl: z.string().url(),
            }),
        ),
        NewHeroArt: createEvent(
            "new_hero_art_image.save",
            z.object({
                appID: Info.shape.id,
                backdropUrl: z.string().url(),
                screenshots: z.string().url().array(),
            }),
        ),
    };

    export const create = fn(
        Info,
        (input) =>
            createTransaction(async (tx) => {
                const result = await tx
                    .select()
                    .from(baseGamesTable)
                    .where(
                        and(
                            eq(baseGamesTable.id, input.id),
                            isNull(baseGamesTable.timeDeleted)
                        )
                    )
                    .limit(1)
                    .execute()
                    .then(rows => rows.at(0))

                if (result) return result.id

                await tx
                    .insert(baseGamesTable)
                    .values(input)
                    .onConflictDoUpdate({
                        target: baseGamesTable.id,
                        set: {
                            timeDeleted: null
                        }
                    })

                await afterTx(async () => {
                    const imageUrls = await Client.getImageUrls(input.id);

                    // Spread them into different event buses as they take up way too much RAM if done in one go
                    await Promise.all(
                        ImageTypeEnum.enumValues.map(async (type) => {
                            switch (type) {
                                case "backdrop": {
                                    await bus.publish(Resource.Bus, Events.New, { appID: input.id, type: "backdrop", url: imageUrls.backdrop })
                                    break;
                                }
                                case "banner": {
                                    await bus.publish(Resource.Bus, Events.New, { appID: input.id, type: "banner", url: imageUrls.banner })
                                    break;
                                }
                                case "icon": {
                                    await bus.publish(Resource.Bus, Events.New, { appID: input.id, type: "icon", url: imageUrls.icon })
                                    break;
                                }
                                case "logo": {
                                    await bus.publish(Resource.Bus, Events.New, { appID: input.id, type: "icon", url: imageUrls.logo })
                                    break;
                                }
                                case "poster": {
                                    await bus.publish(
                                        Resource.Bus,
                                        Events.New,
                                        { appID: input.id, type: "poster", url: imageUrls.poster }
                                    )
                                    break;
                                }
                                case "heroArt": {
                                    await bus.publish(
                                        Resource.Bus,
                                        Events.NewHeroArt,
                                        { appID: input.id, backdropUrl: imageUrls.backdrop, screenshots: imageUrls.screenshots }
                                    )
                                    break;
                                }
                                case "boxArt": {
                                    await bus.publish(
                                        Resource.Bus,
                                        Events.NewBoxArt,
                                        { appID: input.id, logoUrl: imageUrls.logo, backgroundUrl: imageUrls.backdrop }
                                    )
                                    break;
                                }
                            }
                        })
                    )
                })

                return input.id
            })
    )

    export const fromID = fn(
        Info.shape.id,
        (id) =>
            useTransaction(async (tx) =>
                tx
                    .select()
                    .from(baseGamesTable)
                    .where(
                        and(
                            eq(baseGamesTable.id, id),
                            isNull(baseGamesTable.timeDeleted)
                        )
                    )
                    .limit(1)
                    .then(rows => rows.map(serialize).at(0))
            )
    )

    export function serialize(
        input: typeof baseGamesTable.$inferSelect,
    ): z.infer<typeof Info> {
        return {
            id: input.id,
            name: input.name,
            slug: input.slug,
            size: input.size,
            score: input.score,
            description: input.description,
            releaseDate: input.releaseDate,
            primaryGenre: input.primaryGenre,
            compatibility: input.compatibility,
            controllerSupport: input.controllerSupport,
        };
    }
}