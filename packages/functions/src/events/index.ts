import { Resource } from "sst";
import { bus } from "sst/aws/bus";
import { Steam } from "@nestri/core/steam/index";
import { Client } from "@nestri/core/client/index";
import { Images } from "@nestri/core/images/index";
import { Friend } from "@nestri/core/friend/index";
import { BaseGame } from "@nestri/core/base-game/index";
import { Credentials } from "@nestri/core/credentials/index";
import { EAuthTokenPlatformType, LoginSession } from "steam-session";
import { PutObjectCommand, S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({});

export const handler = bus.subscriber(
  [Credentials.Events.New, BaseGame.Events.New],
  async (event) => {
    console.log(event.type, event.properties, event.metadata);
    switch (event.type) {
      case "new_credentials.added": {
        const input = event.properties
        const credentials = await Credentials.fromSteamID(input.steamID)
        if (credentials) {
          const session = new LoginSession(EAuthTokenPlatformType.MobileApp);

          session.refreshToken = credentials.refreshToken;

          const cookies = await session.getWebCookies();

          const friends = await Client.getFriendsList(cookies);

          const putFriends = friends.map(async (user) => {
            const wasAdded =
              await Steam.create({
                id: user.steamID.toString(),
                name: user.name,
                realName: user.realName,
                avatarHash: user.avatarHash,
                steamMemberSince: user.memberSince,
                profileUrl: user.customURL?.trim() || null,
                limitations: {
                  isLimited: user.isLimitedAccount,
                  isVacBanned: user.vacBanned,
                  tradeBanState: user.tradeBanState.toLowerCase() as any,
                  privacyState: user.privacyState as any,
                  visibilityState: Number(user.visibilityState)
                }
              })

            if (!wasAdded) {
              console.log(`Steam user ${user.steamID.toString()} already exists`)
            }

            await Friend.add({ friendSteamID: user.steamID.toString(), steamID: input.steamID })
          })

          const settled = await Promise.allSettled(putFriends);

          settled
            .filter(result => result.status === 'rejected')
            .forEach(result => console.warn('[putFriends] failed:', (result as PromiseRejectedResult).reason))
        }
        break;
      }
      case "new_game.added": {
        const input = event.properties
        // Get images and save to s3
        const images = await Client.getImages(input.appID);

        (await Promise.allSettled(
          images.map(async (image) => {
            // Put the images into the db
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
        ))
          .filter(i => i.status === "rejected")
          .forEach(r => console.warn("[createImages] failed:", (r as PromiseRejectedResult).reason));

        break;
      }
    }
  },
);