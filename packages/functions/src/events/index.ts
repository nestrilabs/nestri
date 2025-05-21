import "zod-openapi/extend";
import { Resource } from "sst";
import { bus } from "sst/aws/bus";
import { Actor } from "@nestri/core/actor";
import { Game } from "@nestri/core/game/index";
import { Steam } from "@nestri/core/steam/index";
import { Client } from "@nestri/core/client/index";
import { Images } from "@nestri/core/images/index";
import { Library } from "@nestri/core/library/index";
import { BaseGame } from "@nestri/core/base-game/index";
import { Categories } from "@nestri/core/categories/index";
import { PutObjectCommand, S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({});

export const handler = bus.subscriber(
  [
    BaseGame.Events.New,
    Steam.Events.Updated,
    Steam.Events.Created,
    BaseGame.Events.NewBoxArt,
    BaseGame.Events.NewHeroArt,
  ],
  async (event) => {
    console.log(event.type, event.properties, event.metadata);
    switch (event.type) {
      case "new_image.save": {
        const input = event.properties;
        const image = await Client.getImageInfo({ url: input.url, type: input.type });

        await Images.create({
          type: image.type,
          imageHash: image.hash,
          baseGameID: input.appID,
          position: image.position,
          fileSize: image.fileSize,
          sourceUrl: image.sourceUrl,
          dimensions: image.dimensions,
          extractedColor: image.averageColor,
        });

        try {
          //Check whether the image already exists
          await s3.send(
            new HeadObjectCommand({
              Bucket: Resource.Storage.name,
              Key: `images/${image.hash}`,
            })
          );

        } catch (e) {
          // Save to s3 because it doesn't already exist
          await s3.send(
            new PutObjectCommand({
              Bucket: Resource.Storage.name,
              Key: `images/${image.hash}`,
              Body: image.buffer,
              ...(image.format && { ContentType: `image/${image.format}` }),
              Metadata: {
                type: image.type,
                appID: input.appID,
              }
            })
          )
        }

        break;
      }
      case "new_box_art_image.save": {
        const input = event.properties;

        const image = await Client.createBoxArt(input);

        await Images.create({
          type: image.type,
          imageHash: image.hash,
          baseGameID: input.appID,
          position: image.position,
          fileSize: image.fileSize,
          sourceUrl: image.sourceUrl,
          dimensions: image.dimensions,
          extractedColor: image.averageColor,
        });

        try {
          //Check whether the image already exists
          await s3.send(
            new HeadObjectCommand({
              Bucket: Resource.Storage.name,
              Key: `images/${image.hash}`,
            })
          );

        } catch (e) {
          // Save to s3 because it doesn't already exist
          await s3.send(
            new PutObjectCommand({
              Bucket: Resource.Storage.name,
              Key: `images/${image.hash}`,
              Body: image.buffer,
              ...(image.format && { ContentType: `image/${image.format}` }),
              Metadata: {
                type: image.type,
                appID: input.appID,
              }
            })
          )
        }

        break;
      }
      case "new_hero_art_image.save": {
        const input = event.properties;

        const images = await Client.createHeroArt(input);

        const settled =
          await Promise.allSettled(
            images.map(async (image) => {
              await Images.create({
                type: image.type,
                imageHash: image.hash,
                baseGameID: input.appID,
                position: image.position,
                fileSize: image.fileSize,
                sourceUrl: image.sourceUrl,
                dimensions: image.dimensions,
                extractedColor: image.averageColor,
              });

              try {
                //Check whether the image already exists
                await s3.send(
                  new HeadObjectCommand({
                    Bucket: Resource.Storage.name,
                    Key: `images/${image.hash}`,
                  })
                );

              } catch (e) {
                // Save to s3 because it doesn't already exist
                await s3.send(
                  new PutObjectCommand({
                    Bucket: Resource.Storage.name,
                    Key: `images/${image.hash}`,
                    Body: image.buffer,
                    ...(image.format && { ContentType: `image/${image.format}` }),
                    Metadata: {
                      type: image.type,
                      appID: input.appID,
                    }
                  })
                )
              }
            })
          )

        settled
          .filter(r => r.status === "rejected")
          .forEach(r => console.warn("[processHeroArt] failed:", (r as PromiseRejectedResult).reason));

        break;
      }
      case "steam_account.updated":
      case "steam_account.created": {
        //Get user library and commit it to the db
        const steamID = event.properties.steamID;

        await Actor.provide(
          event.metadata.actor.type,
          event.metadata.actor.properties,
          async () => {
            //Get user library
            const gameLibrary = await Client.getUserLibrary(steamID);

            const myLibrary = new Map(gameLibrary.response.games.map(g => [g.appid, g]))

            const queryLib = await Promise.allSettled(
              gameLibrary.response.games.map(async (game) => {
                return await Client.getAppInfo(game.appid.toString())
              })
            )

            queryLib
              .filter(i => i.status === "rejected")
              .forEach(e => console.warn(`[getAppInfo]: Failed to get game metadata: ${e.reason}`))

            const gameInfo = queryLib.filter(i => i.status === "fulfilled").map(f => f.value)

            const queryGames = gameInfo.map(async (game) => {
              await BaseGame.create(game);

              const allCategories = [...game.tags, ...game.genres, ...game.publishers, ...game.developers];

              const uniqueCategories = Array.from(
                new Map(allCategories.map(c => [`${c.type}:${c.slug}`, c])).values()
              );

              const gameSettled = await Promise.allSettled(
                uniqueCategories.map(async (cat) => {
                  //Use a single db transaction to get or set the category
                  await Categories.create({
                    type: cat.type, slug: cat.slug, name: cat.name
                  })

                  // Use a single db transaction to get or create the game
                  await Game.create({ baseGameID: game.id, categorySlug: cat.slug, categoryType: cat.type })
                })
              )

              gameSettled
                .filter(r => r.status === "rejected")
                .forEach(r => console.warn("[uniqueCategories] failed:", (r as PromiseRejectedResult).reason));

              const currentGameInLibrary = myLibrary.get(parseInt(game.id))
              if (currentGameInLibrary) {
                await Library.add({
                  baseGameID: game.id,
                  lastPlayed: currentGameInLibrary.rtime_last_played ? new Date(currentGameInLibrary.rtime_last_played * 1000) : null,
                  totalPlaytime: currentGameInLibrary.playtime_forever,
                })
              } else {
                throw new Error(`Game is not in library, but was found in app info:${game.id}`)
              }
            })

            const settled = await Promise.allSettled(queryGames);

            settled
              .filter(i => i.status === "rejected")
              .forEach(e => console.warn(`[gameCreate]: Failed to create game: ${e.reason}`))
          })

        break;
      }
    }
  },
);