import SteamID from "steamid"
import { fn } from "../utils";
import { SteamApiResponse } from "./types";
import SteamCommunity from "steamcommunity";
import { Credentials } from "../credentials";
import CSteamUser from "steamcommunity/classes/CSteamUser";

export namespace Client {
    export const getUserLibrary = fn(
        Credentials.Info.shape.accessToken,
        async (accessToken) =>
            await fetch(`https://api.steampowered.com/IFamilyGroupsService/GetSharedLibraryApps/v1/?access_token=${accessToken}&family_groupid=0&include_excluded=true&include_free=true&include_non_games=false&include_own=true`)
                .then(r => r.json()) as SteamApiResponse
    )

    export const getFriendsList = fn(
        Credentials.Info.shape.cookies,
        async (cookies) =>
            new Promise((resolve, reject) => {
                const community = new SteamCommunity()
                community.setCookies(cookies);
                community.getFriendsList((error, allFriends) => {
                    if (error) {
                        reject(`Could not get friends list: ${error.message}`)
                    } else {
                        const friends = Object.entries(allFriends);
                        for (const [id, _nonce] of friends) {
                            const friendID = new SteamID(id);
                            community.getSteamUser(friendID, async (err, user) => {
                                if (err) {
                                    reject(`Could not get steam user info: ${err.message}`)
                                } else {
                                    resolve(user)
                                }
                            })
                        }
                    }
                })
            }) as Promise<CSteamUser>
    )

    export const getUserInfo = fn(
        Credentials.Info.pick({ cookies: true, id: true }),
        async (input) =>
            new Promise((resolve, reject) => {
                const community = new SteamCommunity()
                community.setCookies(input.cookies);
                const steamID = new SteamID(input.id);
                community.getSteamUser(steamID, async (err, user) => {
                    if (err) {
                        reject(`Could not get steam user info: ${err.message}`)
                    } else {
                        resolve(user)
                    }
                })
            }) as Promise<CSteamUser>
    )
}