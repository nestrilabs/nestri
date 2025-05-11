import { bus } from "sst/aws/bus";
import { Steam } from "@nestri/core/steam/index";
import { Client } from "@nestri/core/client/index";
import { Friend } from "@nestri/core/friend/index";
import { Credentials } from "@nestri/core/credentials/index";
import { EAuthTokenPlatformType, LoginSession } from "steam-session";

export const handler = bus.subscriber(
  [Credentials.Events.New],
  async (event) => {
    console.log(event.type, event.properties, event.metadata);
    switch (event.type) {
      case "new_credentials.added": {
        const input = event.properties
        const credentials = await Credentials.fromID(input.steamID)
        if (credentials) {
          const session = new LoginSession(EAuthTokenPlatformType.MobileApp);

          session.refreshToken = credentials.refreshToken;

          const cookies = await session.getWebCookies()

          const friends = await Client.getFriendsList(cookies)

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

            if (!!wasAdded) {
              console.log(`Steam user ${user.steamID.toString()} already exists`)
            }

            await Friend.add({ friendSteamID: user.steamID.toString(), steamID: input.steamID })
          })

          await Promise.allSettled(putFriends)
        }
        break;
      }
    }
  },
);