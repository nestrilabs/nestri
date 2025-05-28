import "zod-openapi/extend";
import { Resource } from "sst";
import { bus } from "sst/aws/bus";
import { SQSHandler } from "aws-lambda";
import { Actor } from "@nestri/core/actor";
import { Game } from "@nestri/core/game/index";
import { Client } from "@nestri/core/client/index";
import { Library } from "@nestri/core/library/index";
import { BaseGame } from "@nestri/core/base-game/index";
import { Categories } from "@nestri/core/categories/index";
import { ImageTypeEnum } from "@nestri/core/images/images.sql";

export const handler: SQSHandler = async (event) => {
    for (const record of event.Records) {
        const parsed = JSON.parse(
            record.body,
        ) as typeof Library.Events.Queue.$payload;

        await Actor.provide(
            parsed.metadata.actor.type,
            parsed.metadata.actor.properties,
            async () => {
                const game = parsed.properties
                // First check whether the base_game exists, if not get it
                const appID = game.appID.toString();
                const exists = await BaseGame.fromID(appID);

                if (!exists) {
                    const appInfo = await Client.getAppInfo(appID);

                    await BaseGame.create({
                        id: appID,
                        name: appInfo.name,
                        size: appInfo.size,
                        slug: appInfo.slug,
                        links: appInfo.links,
                        score: appInfo.score,
                        description: appInfo.description,
                        releaseDate: appInfo.releaseDate,
                        primaryGenre: appInfo.primaryGenre,
                        compatibility: appInfo.compatibility,
                        controllerSupport: appInfo.controllerSupport,
                    })

                    const allCategories = [...appInfo.tags, ...appInfo.genres, ...appInfo.publishers, ...appInfo.developers, ...appInfo.categories, ...appInfo.franchises]

                    const uniqueCategories = Array.from(
                        new Map(allCategories.map(c => [`${c.type}:${c.slug}`, c])).values()
                    );

                    await Promise.all(
                        uniqueCategories.map(async (cat) => {
                            //Create category if it doesn't exist
                            await Categories.create({
                                type: cat.type, slug: cat.slug, name: cat.name
                            })

                            //Create game if it doesn't exist
                            await Game.create({ baseGameID: appID, categorySlug: cat.slug, categoryType: cat.type })
                        })
                    )

                    const imageUrls = appInfo.images

                    await Promise.all(
                        ImageTypeEnum.enumValues.map(async (type) => {
                            switch (type) {
                                case "backdrop": {
                                    await bus.publish(Resource.Bus, BaseGame.Events.New, { appID, type: "backdrop", url: imageUrls.backdrop })
                                    break;
                                }
                                case "banner": {
                                    await bus.publish(Resource.Bus, BaseGame.Events.New, { appID, type: "banner", url: imageUrls.banner })
                                    break;
                                }
                                case "icon": {
                                    await bus.publish(Resource.Bus, BaseGame.Events.New, { appID, type: "icon", url: imageUrls.icon })
                                    break;
                                }
                                case "logo": {
                                    await bus.publish(Resource.Bus, BaseGame.Events.New, { appID, type: "logo", url: imageUrls.logo })
                                    break;
                                }
                                case "poster": {
                                    await bus.publish(
                                        Resource.Bus,
                                        BaseGame.Events.New,
                                        { appID, type: "poster", url: imageUrls.poster }
                                    )
                                    break;
                                }
                                case "heroArt": {
                                    await bus.publish(
                                        Resource.Bus,
                                        BaseGame.Events.NewHeroArt,
                                        { appID, backdropUrl: imageUrls.backdrop, screenshots: imageUrls.screenshots }
                                    )
                                    break;
                                }
                                case "boxArt": {
                                    await bus.publish(
                                        Resource.Bus,
                                        BaseGame.Events.NewBoxArt,
                                        { appID, logoUrl: imageUrls.logo, backgroundUrl: imageUrls.backdrop }
                                    )
                                    break;
                                }
                            }
                        })
                    )
                }

                // Add to user's library
                await Library.add({
                    baseGameID: appID,
                    lastPlayed: game.lastPlayed ? new Date(game.lastPlayed) : null,
                    totalPlaytime: game.totalPlaytime,
                })
            })
    }
}

