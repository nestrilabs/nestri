import { bus } from "sst/aws/bus";
import { Actor } from "@nestri/core/actor";
import { User } from "@nestri/core/user/index";
import { Email } from "@nestri/core/email/index"
import { Steam } from "@nestri/core/steam/index";
import { Friend } from "@nestri/core/friend/index";
import { SteamClient } from "@nestri/core/steam/client";

export const handler = bus.subscriber(
  [User.Events.Created, Steam.Events.Created, Steam.Events.New, Steam.Events.Updated],
  async (event) => {
    console.log(event.type, event.properties, event.metadata);
    switch (event.type) {
      case "user.created": {
        console.log("Send email here")
        // const actor = useActor()
        // if (actor.type !== "user") throw new Error("User actor is needed here")
        // await Email.send(
        //   "welcome",
        //   actor.properties.email,
        //   `Welcome to Nestri`,
        //   `Welcome to Nestri`,
        // )
        //     await Stripe.syncUser(event.properties.userID);
        break;
      }
      case "new_credentials.added": {
        // Here we extract their games, and then send the supported games to a queue
        const { steamID } = event.properties
        const credentials = await Steam.getCredentialByID(steamID)
        if (credentials) {
          const { cookies } = await SteamClient.generateTokens(credentials.refreshToken);

          const games = await SteamClient.getOwnedGamesCompatList({ cookies });

          


        }
        break;
      }
      case "steam_account.updated":
      case "steam_account.created": {
        // Here we first check whether a userID was passed (means they already have a Nestri account)
        // Then extract their friends and save them to a database
        if (event.properties.userID) {
          const { steamID } = event.properties
          const credentials = await Steam.getCredentialByID(steamID)

          if (credentials) {
            const { accessToken } = await SteamClient.generateTokens(credentials.refreshToken);

            const friends = await SteamClient.getFriends({ accessToken, steamIDs: [steamID] });

            const friendsSteamIDs = friends.friends.map(i => BigInt(i.steamid));

            //Get user data for the first 100 friends
            const userData = await SteamClient.getUserData({ accessToken, steamIDs: friendsSteamIDs.slice(0, 100) })

            const userDb = userData.players.map(async (steamUser) => {
              const id =
                await Steam.create({
                  userID: null,
                  id: BigInt(steamUser.steamid),
                  realName: steamUser.realname,
                  avatarHash: steamUser.avatarhash,
                  profileUrl: steamUser.profileurl,
                  personaName: steamUser.personaname,
                })

              if (!id) {
                await Steam.update({
                  id: steamID,
                  userID: undefined,
                  realName: steamUser.realname,
                  avatarHash: steamUser.avatarhash,
                  profileUrl: steamUser.profileurl,
                  personaName: steamUser.personaname,
                })
              }

              // Add this person as a friend
              Actor.provide(
                "steam",
                {
                  steamID
                },
                async () =>
                  await Friend.add({
                    friendSteamID: BigInt(steamUser.steamid)
                  })
              )
            })

            await Promise.allSettled(userDb)
          }
        }
        break;
      }
    }
  },
);