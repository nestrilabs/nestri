import SteamID from "steamid"
import { bus } from "sst/aws/bus";
import SteamCommunity from "steamcommunity";
import { User } from "@nestri/core/user/index";
import { Steam } from "@nestri/core/steam/index";
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
        const credentials = await Credentials.getByID(input.steamID)
        if (credentials) {
          const session = new LoginSession(EAuthTokenPlatformType.MobileApp);

          session.refreshToken = credentials.refreshToken;

          const cookies = await session.getWebCookies()

          const community = new SteamCommunity()
          community.setCookies(cookies);

          community.getFriendsList((error, allFriends) => {
            if (!error) {
              const friends = Object.entries(allFriends);
              for (const [id, nonce] of friends) {
                const friendID = new SteamID(id);
                community.getSteamUser(friendID, async (error, user) => {
                  if (!error) {
                    const wasAdded =
                      await Steam.create({
                        id: friendID.toString(),
                        name: user.name,
                        realName: user.realName,
                        avatarHash: user.avatarHash,
                        steamMemberSince: user.memberSince,
                        profileUrl: user.customURL !== "" ? user.customURL : null,
                        limitations: {
                          isLimited: user.isLimitedAccount,
                          isVacBanned: user.vacBanned,
                          tradeBanState: user.tradeBanState.toLowerCase() as any,
                          privacyState: user.privacyState as any,
                          visibilityState: Number(user.visibilityState)
                        }
                      })

                    if (!wasAdded) {
                      console.log(`steam user ${friendID.toString()} already exists`)
                    }

                    await Friend.add({ friendSteamID: friendID.toString(), steamID: input.steamID })
                  }
                })
              }
            }
          });
        }
        break;
      }
    }
  },
);