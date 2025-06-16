import "zod-openapi/extend";
import { Resource } from "sst";
import { bus } from "sst/aws/bus";
import { Actor } from "@nestri/core/actor";
import { Game } from "@nestri/core/game/index";
import { Steam } from "@nestri/core/steam/index";
import { Client } from "@nestri/core/client/index";
import { Friend } from "@nestri/core/friend/index";
import { Images } from "@nestri/core/images/index";
import { Library } from "@nestri/core/library/index";
import { chunkArray } from "@nestri/core/utils/index";
import { BaseGame } from "@nestri/core/base-game/index";
import { Categories } from "@nestri/core/categories/index";
import { ImageTypeEnum } from "@nestri/core/images/images.sql";
import { PutObjectCommand, S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({});

export const handler = bus.subscriber(
  [
    Library.Events.Add,
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

        await Promise.all(
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

        break;
      }
      case "library.add": {

        await Actor.provide(
          event.metadata.actor.type,
          event.metadata.actor.properties,
          async () => {
            const game = event.properties
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

        break;
      }
      case "steam_account.created":
      case "steam_account.updated": {
        const userID = event.properties.userID;

        try {
          const steamID = event.properties.steamID;
          // Get friends info
          const friends = await Client.getFriendsList(steamID);

          const friendSteamIDs = friends.friendslist.friends.map(f => f.steamid);

          // Steam API has a limit of requesting 100 friends at a go
          const friendChunks = chunkArray(friendSteamIDs, 100);

          const settled = await Promise.allSettled(
            friendChunks.map(async (friendIDs) => {
              const friendsInfo = await Client.getUserInfo(friendIDs)

              return await Promise.all(
                friendsInfo.map(async (friend) => {
                  const wasAdded = await Steam.create(friend);

                  if (!wasAdded) {
                    console.log(`Friend ${friend.id} already exists`)
                  }

                  await Friend.add({ friendSteamID: friend.id, steamID })

                  return friend.id
                })
              )
            })
          )

          settled
            .filter(result => result.status === 'rejected')
            .forEach(result => console.warn('[putFriends] failed:', (result as PromiseRejectedResult).reason))

          const prod = (Resource.App.stage === "production" || Resource.App.stage === "dev")

          const friendIDs = [
            steamID,
            ...(prod ? settled
              .filter(result => result.status === "fulfilled")
              .map(f => f.value)
              .flat() : [])
          ]

          await Promise.all(
            friendIDs.map(async (currentSteamID) => {
              // Get user library
              const gameLibrary = await Client.getUserLibrary(currentSteamID);

              const queryLib = await Promise.allSettled(
                gameLibrary.response.games.map(async (game) => {
                  await Actor.provide(
                    "steam",
                    {
                      steamID: currentSteamID,
                    },
                    async () => {

                      await bus.publish(
                        Resource.Bus,
                        Library.Events.Add,
                        {
                          appID: game.appid,
                          totalPlaytime: game.playtime_forever,
                          lastPlayed: game.rtime_last_played ? new Date(game.rtime_last_played * 1000) : null,
                        }
                      )

                    }
                  )
                })
              )

              queryLib
                .filter(i => i.status === "rejected")
                .forEach(e => console.warn(`[pushUserLib]: Failed to push user library to queue: ${e.reason}`))
            })
          )
        } catch (error: any) {
          console.error(`Failed to process Steam data for user ${userID}:`, error);
        }
        break;
      }
    }
  },
);