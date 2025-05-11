import type {
    AppInfo,
    GameDetailsResponse,
    GameTagsResponse,
    SteamAppDataResponse,
} from "./types";
import { z } from "zod";
import SteamID from "steamid"
import { fn } from "../utils";
import { Utils } from "./utils";
import { SteamApiResponse } from "./types";
import SteamCommunity from "steamcommunity";
import { Credentials } from "../credentials";
import type CSteamUser from "steamcommunity/classes/CSteamUser";

export namespace Client {
    export const getUserLibrary = fn(
        Credentials.Info.shape.accessToken,
        async (accessToken) =>
            await Utils.fetchApi<SteamApiResponse>(`https://api.steampowered.com/IFamilyGroupsService/GetSharedLibraryApps/v1/?access_token=${accessToken}&family_groupid=0&include_excluded=true&include_free=true&include_non_games=false&include_own=true`)
    )

    export const getFriendsList = fn(
        Credentials.Info.shape.cookies,
        async (cookies): Promise<CSteamUser[]> => {
            const community = new SteamCommunity();
            community.setCookies(cookies);

            const allFriends = await new Promise<Record<string, any>>((resolve, reject) => {
                community.getFriendsList((err, friends) => {
                    if (err) {
                        return reject(new Error(`Could not get friends list: ${err.message}`));
                    }
                    resolve(friends);
                });
            });

            const friendIds = Object.keys(allFriends);

            const userPromises: Promise<CSteamUser>[] = friendIds.map(id =>
                new Promise<CSteamUser>((resolve, reject) => {
                    const sid = new SteamID(id);
                    community.getSteamUser(sid, (err, user) => {
                        if (err) {
                            return reject(new Error(`Could not get steam user info for ${id}: ${err.message}`));
                        }
                        resolve(user);
                    });
                })
            );

            return (await Promise.allSettled(userPromises)).filter(s => s.status === "fulfilled").map(i => i.value);
        }
    );

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

    export const getAppInfo = fn(
        z.string(),
        async (appid) => {
            const [infoData, tagsData, details] = await Promise.all([
                Utils.fetchApi<SteamAppDataResponse>(`https://api.steamcmd.net/v1/info/${appid}`),
                Utils.fetchApi<GameTagsResponse>("https://store.steampowered.com/actions/ajaxgetstoretags"),
                Utils.fetchApi<GameDetailsResponse>(
                    `https://store.steampowered.com/apphover/${appid}?full=1&review_score_preference=1&pagev6=true&json=1`
                ),
            ]);

            const tags = tagsData.tags;
            const game = infoData.data[appid];
            const genres = Utils.parseGenres(details.strGenres);

            const controllerTag = !!game.common.controller_support ? Utils.createTag(`${Utils.capitalise(game.common.controller_support)} Controller Support`) : Utils.createTag(`Uknown Controller Support`)
            const compatibilityTag = Utils.createTag(`${Utils.capitalise(Utils.compatibilityType(game.common.steam_deck_compatibility?.category))} Controller Support`)

            const appInfo: AppInfo = {
                genres,
                gameid: game.appid,
                name: game.common.name.trim(),
                size: Utils.getPublicDepotSizes(game.depots!),
                slug: Utils.createSlug(game.common.name.trim()),
                description: Utils.cleanDescription(details.strDescription),
                controller_support: game.common.controller_support as "partial" | "full" ?? "unknown",
                release_date: new Date(Number(game.common.steam_release_date) * 1000),
                primary_genre: Utils.getPrimaryGenre(
                    genres,
                    game.common.genres!,
                    game.common.primary_genre!
                ),
                developers: Array.from(
                    Utils.getAssociationsByTypeWithSlug(
                        game.common.associations!,
                        "developer"
                    )
                ),
                publishers: Array.from(
                    Utils.getAssociationsByTypeWithSlug(
                        game.common.associations!,
                        "publisher"
                    )
                ),
                compatibility: Utils.compatibilityType(game.common.steam_deck_compatibility?.category),
                tags: [
                    ...Utils.mapGameTags(
                        tags,
                        game.common.store_tags!,
                    ),
                    controllerTag,
                    compatibilityTag
                ],
                score: Utils.getRating(
                    details.ReviewSummary.cRecommendationsPositive,
                    details.ReviewSummary.cRecommendationsNegative
                ),
            };

            return appInfo
        }
    )
}