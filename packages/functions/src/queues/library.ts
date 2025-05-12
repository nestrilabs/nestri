import { SQSHandler } from "aws-lambda";
import { Actor } from "@nestri/core/actor";
import { Game } from "@nestri/core/game/index";
import { Utils } from "@nestri/core/client/utils";
import { Client } from "@nestri/core/client/index";
import { Library } from "@nestri/core/library/index";
import { BaseGame } from "@nestri/core/base-game/index";
import { Categories } from "@nestri/core/categories/index";

export const handler: SQSHandler = async (event) => {
    for (const record of event.Records) {
        const parsed = JSON.parse(
            record.body,
        ) as typeof Library.Events.Queue.$payload;

        await Actor.provide(
            parsed.metadata.actor.type,
            parsed.metadata.actor.properties,
            async () => {
                const processGames = parsed.properties.map(async (game) => {
                    // First check whether the base_game exists, if not get it
                    const appID = game.appID.toString()
                    const exists = await BaseGame.fromID(appID)

                    if (!exists) {
                        const appInfo = await Client.getAppInfo(appID);
                        const tags = appInfo.tags;

                        await BaseGame.create({
                            id: appID,
                            name: appInfo.name,
                            size: appInfo.size,
                            score: appInfo.score,
                            slug: appInfo.slug,
                            description: appInfo.description,
                            releaseDate: appInfo.releaseDate,
                            primaryGenre: appInfo.primaryGenre,
                            compatibility: appInfo.compatibility,
                            controllerSupport: appInfo.controllerSupport,
                        })

                        if (game.isFamilyShareAble) {
                            tags.push(Utils.createTag("Family Share"))
                        }

                        const allCategories = [...tags, ...appInfo.genres, ...appInfo.publishers, ...appInfo.developers]

                        await Promise.allSettled(
                            allCategories.map(async (cat) => {
                                // Put up a guard, just in case
                                if (cat.slug && cat.type && cat.name) {
                                    //Use a single db transaction to get or set the category
                                    await Categories.create({
                                        type: cat.type, slug: cat.slug, name: cat.name
                                    })

                                    // Use a single db transaction to get or create the game
                                    await Game.create({ baseGameID: appID, categorySlug: cat.slug, categoryType: cat.type })
                                }
                            })
                        )
                    }

                    // Add to user's library
                    await Library.add({
                        baseGameID: appID,
                        isFamilyShared: game.isFamilyShared,
                        totalPlaytime: game.totalPlaytime,
                        timeAcquired: game.timeAcquired,
                        lastPlayed: game.lastPlayed,
                    })
                })

                await Promise.allSettled(processGames)
            }
        )
    }
}