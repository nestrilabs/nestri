import type {
    AppInfo,
    GameTagsResponse,
    SteamApiResponse,
    GameDetailsResponse,
    SteamAppDataResponse,
    ImageInfo,
    ImageType,
    Shot
} from "./types";
import { z } from "zod";
import pLimit from 'p-limit';
import SteamID from "steamid";
import { fn } from "../utils";
import { Utils } from "./utils";
import SteamCommunity from "steamcommunity";
import { Credentials } from "../credentials";
import type CSteamUser from "steamcommunity/classes/CSteamUser";

const requestLimit = pLimit(10); // max concurrent requests

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
                requestLimit(() => new Promise<CSteamUser>((resolve, reject) => {
                    const sid = new SteamID(id);
                    community.getSteamUser(sid, (err, user) => {
                        if (err) {
                            return reject(new Error(`Could not get steam user info for ${id}: ${err.message}`));
                        }
                        resolve(user);
                    });
                }))
            );

            const settled = await Promise.allSettled(userPromises)

            settled
                .filter(r => r.status === "rejected")
                .forEach(r => console.warn("[getFriendsList] failed:", (r as PromiseRejectedResult).reason));

            return settled.filter(s => s.status === "fulfilled").map(r => (r as PromiseFulfilledResult<CSteamUser>).value);
        }
    );

    export const getUserInfo = fn(
        Credentials.Info.pick({ cookies: true, steamID: true }),
        async (input) =>
            new Promise((resolve, reject) => {
                const community = new SteamCommunity()
                community.setCookies(input.cookies);
                const steamID = new SteamID(input.steamID);
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
            // Guard against an empty string - When there are no genres, Steam returns an empty string
            const genres = details.strGenres ? Utils.parseGenres(details.strGenres) : [];

            const controllerTag = game.common.controller_support ?
                Utils.createTag(`${Utils.capitalise(game.common.controller_support)} Controller Support`) :
                Utils.createTag(`Unknown Controller Support`)

            const compatibilityTag = Utils.createTag(`${Utils.capitalise(Utils.compatibilityType(game.common.steam_deck_compatibility?.category))} Compatibility`)

            const appInfo: AppInfo = {
                genres,
                gameid: game.appid,
                name: game.common.name.trim(),
                size: Utils.getPublicDepotSizes(game.depots!),
                slug: Utils.createSlug(game.common.name.trim()),
                description: Utils.cleanDescription(details.strDescription),
                controllerSupport: game.common.controller_support as "partial" | "full" ?? "unknown",
                releaseDate: new Date(Number(game.common.steam_release_date) * 1000),
                primaryGenre: (!!game?.common.genres && !!details.strGenres) ? Utils.getPrimaryGenre(
                    genres,
                    game.common.genres!,
                    game.common.primary_genre!
                ) : null,
                developers: game.common.associations ?
                    Array.from(
                        Utils.getAssociationsByTypeWithSlug(
                            game.common.associations!,
                            "developer"
                        )
                    ) : [],
                publishers: game.common.associations ?
                    Array.from(
                        Utils.getAssociationsByTypeWithSlug(
                            game.common.associations!,
                            "publisher"
                        )
                    ) : [],
                compatibility: Utils.compatibilityType(game.common.steam_deck_compatibility?.category),
                tags: [
                    ...(game?.common.store_tags ?
                        Utils.mapGameTags(
                            tags,
                            game.common.store_tags!,
                        ) : []),
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

    export const getImages = fn(
        z.string(),
        async (appid) => {
            const [appData, details] = await Promise.all([
                Utils.fetchApi<SteamAppDataResponse>(`https://api.steamcmd.net/v1/info/${appid}`),
                Utils.fetchApi<GameDetailsResponse>(
                    `https://store.steampowered.com/apphover/${appid}?full=1&review_score_preference=1&pagev6=true&json=1`
                ),
            ]);

            const game = appData.data[appid]?.common;
            if (!game) throw new Error('Game info missing');

            // 2. Prepare URLs
            const screenshotUrls = Utils.getScreenshotUrls(details.rgScreenshots || []);
            const assetUrls = Utils.getAssetUrls(game.library_assets_full, appid, game.header_image.english);
            const iconUrl = `https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/${appid}/${game.icon}.jpg`;

            //2.5 Get the backdrop buffer and use it to get the best screenshot
            const baselineBuffer = await Utils.fetchBuffer(assetUrls.backdrop);

            // 3. Download screenshot buffers in parallel
            const shots: Shot[] = await Promise.all(
                screenshotUrls.map(async url => ({ url, buffer: await Utils.fetchBuffer(url) }))
            );

            // 4. Score screenshots (or pick single)
            const scores =
                shots.length === 1
                    ? [{ url: shots[0].url, score: 0 }]
                    : (await Utils.rankScreenshots(baselineBuffer, shots, {
                        threshold: 0.08,
                    }))

            // Build url->rank map
            const rankMap = new Map<string, number>();
            scores.forEach((s, i) => rankMap.set(s.url, i));

            // 5. Create tasks for all images
            const tasks: Array<Promise<ImageInfo>> = [];

            // 5a. Screenshots and heroArt metadata (top 4)
            for (const { url, buffer } of shots) {
                const rank = rankMap.get(url);
                if (rank === undefined || rank >= 4) continue;
                const type: ImageType = rank === 0 ? 'heroArt' : 'screenshot';
                tasks.push(
                    Utils.getImageMetadata(buffer).then(meta => ({ ...meta, sourceUrl: url, position: type == "screenshot" ? rank - 1 : rank, type } as ImageInfo))
                );
            }

            // 5b. Asset images
            for (const [type, url] of Object.entries({ ...assetUrls, icon: iconUrl })) {
                if (!url || type === "backdrop") continue;
                tasks.push(
                    Utils.fetchBuffer(url)
                        .then(buf => Utils.getImageMetadata(buf))
                        .then(meta => ({ ...meta, position: 0, sourceUrl: url, type: type as ImageType } as ImageInfo))
                );
            }

            // 5c. Backdrop
            tasks.push(
                Utils.getImageMetadata(baselineBuffer)
                    .then(meta => ({ ...meta, position: 0, sourceUrl: assetUrls.backdrop, type: "backdrop" as const } as ImageInfo))
            )

            // 5d. Box art
            tasks.push(
                Utils.createBoxArtBuffer(game.library_assets_full, appid)
                    .then(buf => Utils.getImageMetadata(buf))
                    .then(meta => ({ ...meta, position: 0, sourceUrl: null, type: 'boxArt' as const }) as ImageInfo)
            );

            const settled = await Promise.allSettled(tasks)

            settled
                .filter(r => r.status === "rejected")
                .forEach(r => console.warn("[getImages] failed:", (r as PromiseRejectedResult).reason));

            // 6. Await all and return
            return settled.filter(s => s.status === "fulfilled").map(r => (r as PromiseFulfilledResult<ImageInfo>).value)
        }
    )
}