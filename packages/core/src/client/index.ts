import type {
    Shot,
    AppInfo,
    ImageInfo,
    ImageType,
    SteamAccount,
    GameTagsResponse,
    GameDetailsResponse,
    SteamAppDataResponse,
    SteamOwnedGamesResponse,
    SteamPlayerBansResponse,
    SteamFriendsListResponse,
    SteamPlayerSummaryResponse,
    SteamStoreResponse,
} from "./types";
import { z } from "zod";
import { fn } from "../utils";
import { Resource } from "sst";
import { Steam } from "./steam";
import { Utils } from "./utils";
import { ImageTypeEnum } from "../images/images.sql";

export namespace Client {
    export const getUserLibrary = fn(
        z.string(),
        async (steamID) =>
            await Utils.fetchApi<SteamOwnedGamesResponse>(`https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=${Resource.SteamApiKey.value}&steamid=${steamID}&include_appinfo=1&format=json&include_played_free_games=1&skip_unvetted_apps=0`)
    )

    export const getFriendsList = fn(
        z.string(),
        async (steamID) =>
            await Utils.fetchApi<SteamFriendsListResponse>(`https://api.steampowered.com/ISteamUser/GetFriendList/v0001/?key=${Resource.SteamApiKey.value}&steamid=${steamID}&relationship=friend`)
    );

    export const getUserInfo = fn(
        z.string().array(),
        async (steamIDs) => {
            const [userInfo, banInfo, profileInfo] = await Promise.all([
                Utils.fetchApi<SteamPlayerSummaryResponse>(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${Resource.SteamApiKey.value}&steamids=${steamIDs.join(",")}`),
                Utils.fetchApi<SteamPlayerBansResponse>(`https://api.steampowered.com/ISteamUser/GetPlayerBans/v1/?key=${Resource.SteamApiKey.value}&steamids=${steamIDs.join(",")}`),
                Utils.fetchProfilesInfo(steamIDs)
            ])

            // Create a map of bans by steamID for fast lookup
            const bansBySteamID = new Map(
                banInfo.players.map((b) => [b.SteamId, b])
            );

            // Map userInfo.players to your desired output using Promise.allSettled 
            // to prevent one error from closing down the whole pipeline
            const steamAccounts = await Promise.allSettled(
                userInfo.response.players.map(async (player) => {
                    const ban = bansBySteamID.get(player.steamid);
                    const info = profileInfo.get(player.steamid);

                    if (!info) {
                        throw new Error(`[userInfo] profile info missing for ${player.steamid}`)
                    }

                    if ('error' in info) {
                        throw new Error(`error handling profile info for: ${player.steamid}:${info.error}`)
                    } else {
                        return {
                            id: player.steamid,
                            name: player.personaname,
                            realName: player.realname ?? null,
                            steamMemberSince: new Date(player.timecreated * 1000),
                            avatarHash: player.avatarhash,
                            limitations: {
                                isLimited: info.isLimited,
                                privacyState: info.privacyState,
                                isVacBanned: ban?.VACBanned ?? false,
                                tradeBanState: ban?.EconomyBan ?? "none",
                                visibilityState: player.communityvisibilitystate,
                            },
                            lastSyncedAt: new Date(),
                            profileUrl: player.profileurl,
                        };
                    }
                })
            );

            steamAccounts
                .filter(result => result.status === 'rejected')
                .forEach(result => console.warn('[userInfo] failed:', (result as PromiseRejectedResult).reason))

            return steamAccounts.filter(result => result.status === "fulfilled").map(result => (result as PromiseFulfilledResult<SteamAccount>).value)
        })

    export const getAppInfo = fn(
        z.string(),
        async (appid) => {
            try {
                const info = await Promise.all([
                    Utils.fetchApi<SteamAppDataResponse>(`https://api.steamcmd.net/v1/info/${appid}`),
                    Utils.fetchApi<SteamStoreResponse>(`https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?key=${Resource.SteamApiKey.value}&input_json={"ids":[{"appid":"${appid}"}],"context":{"language":"english","country_code":"US","steam_realm":"1"},"data_request":{"include_assets":true,"include_release":true,"include_platforms":true,"include_all_purchase_options":true,"include_screenshots":true,"include_trailers":true,"include_ratings":true,"include_tag_count":"40","include_reviews":true,"include_basic_info":true,"include_supported_languages":true,"include_full_description":true,"include_included_items":true,"include_assets_without_overrides":true,"apply_user_filters":true,"include_links":true}}`),
                ]);

                const cmd = info[0].data[appid]
                const store = info[1].response.store_items[0]

                if (!cmd) {
                    throw new Error(`App data not found for appid: ${appid}`)
                }

                if (!store || store.success !== 1) {
                    throw new Error(`Could not get store information or appid: ${appid}`)
                }

                const tags = store.tagids
                    .map(id => Steam.tags[id.toString() as keyof typeof Steam.tags])
                    .filter((name): name is string => typeof name === 'string')

                const publishers = store.basic_info.publishers
                    .map(i => i.name)

                const developers = store.basic_info.developers
                    .map(i => i.name)

                const franchises = store.basic_info.franchises
                    ?.map(i => i.name)

                const genres = cmd?.common.genres &&
                    Object.keys(cmd?.common.genres)
                        .map(id => Steam.genres[id.toString() as keyof typeof Steam.genres])
                        .filter((name): name is string => typeof name === 'string')

                const categories = [
                    ...(store.categories?.controller_categoryids?.map(i => Steam.categories[i.toString() as keyof typeof Steam.categories]) ?? []),
                    ...(store.categories?.supported_player_categoryids?.map(i => Steam.categories[i.toString() as keyof typeof Steam.categories]) ?? [])
                ].filter((name): name is string => typeof name === 'string')

                const assetUrls = Utils.getAssetUrls(cmd?.common.library_assets_full, appid, cmd?.common.header_image.english);

                const screenshots = store.screenshots.all_ages_screenshots?.map(i => `https://shared.cloudflare.steamstatic.com/store_item_assets/${i.filename}`) ?? [];

                const icon = `https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/${appid}/${cmd?.common.icon}.jpg`;

                const data: AppInfo = {
                    id: appid,
                    name: cmd?.common.name.trim(),
                    tags: Utils.createType(tags, "tag"),
                    images: { screenshots, icon, ...assetUrls },
                    size: Utils.getPublicDepotSizes(cmd?.depots!),
                    slug: Utils.createSlug(cmd?.common.name.trim()),
                    publishers: Utils.createType(publishers, "publisher"),
                    developers: Utils.createType(developers, "developer"),
                    categories: Utils.createType(categories, "categorie"),
                    links: store.links ? store.links.map(i => i.url) : null,
                    genres: genres ? Utils.createType(genres, "genre") : [],
                    franchises: franchises ? Utils.createType(franchises, "franchise") : [],
                    description: store.basic_info.short_description ? Utils.cleanDescription(store.basic_info.short_description) : null,
                    controllerSupport: cmd?.common.controller_support ?? "unknown" as any,
                    releaseDate: new Date(Number(cmd?.common.steam_release_date) * 1000),
                    primaryGenre: !!cmd?.common.primary_genre && Steam.genres[cmd?.common.primary_genre as keyof typeof Steam.genres] ? Steam.genres[cmd?.common.primary_genre as keyof typeof Steam.genres] : null,
                    compatibility: store?.platforms.steam_os_compat_category ? Utils.compatibilityType(store?.platforms.steam_os_compat_category.toString() as any).toLowerCase() : "unknown" as any,
                    score: Utils.estimateRatingFromSummary(store.reviews.summary_filtered.review_count, store.reviews.summary_filtered.percent_positive)
                }

                return data
            } catch (err) {
                console.log(`Error handling: ${appid}`)
                throw err
            }
        }
    )

    export const getImageUrls = fn(
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
            const screenshots = Utils.getScreenshotUrls(details.rgScreenshots || []);
            const assetUrls = Utils.getAssetUrls(game.library_assets_full, appid, game.header_image.english);
            const icon = `https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/${appid}/${game.icon}.jpg`;

            return { screenshots, icon, ...assetUrls }
        }
    )

    export const getImageInfo = fn(
        z.object({
            type: z.enum(ImageTypeEnum.enumValues),
            url: z.string()
        }),
        async (input) =>
            Utils.fetchBuffer(input.url)
                .then(buf => Utils.getImageMetadata(buf))
                .then(meta => ({ ...meta, position: 0, sourceUrl: input.url, type: input.type } as ImageInfo))
    )

    export const createBoxArt = fn(
        z.object({
            backgroundUrl: z.string(),
            logoUrl: z.string(),
        }),
        async (input) =>
            Utils.createBoxArtBuffer(input.logoUrl, input.backgroundUrl)
                .then(buf => Utils.getImageMetadata(buf))
                .then(meta => ({ ...meta, position: 0, sourceUrl: null, type: 'boxArt' as const }) as ImageInfo)
    )

    export const createHeroArt = fn(
        z.object({
            screenshots: z.string().array(),
            backdropUrl: z.string()
        }),
        async (input) => {
            // Download screenshot buffers in parallel
            const shots: Shot[] = await Promise.all(
                input.screenshots.map(async url => ({ url, buffer: await Utils.fetchBuffer(url) }))
            );

            const baselineBuffer = await Utils.fetchBuffer(input.backdropUrl);

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

            const settled = await Promise.allSettled(tasks);

            settled
                .filter(r => r.status === "rejected")
                .forEach(r => console.warn("[getHeroArt] failed:", (r as PromiseRejectedResult).reason));

            // Await all and return
            return settled.filter(s => s.status === "fulfilled").map(r => (r as PromiseFulfilledResult<ImageInfo>).value)
        }
    )

    /**
     * Verifies a Steam OpenID response by sending a request back to Steam
     * with mode=check_authentication
     */
    export async function verifyOpenIDResponse(params: URLSearchParams): Promise<string | null> {
        try {
            // Create a new URLSearchParams with all the original parameters
            const verificationParams = new URLSearchParams();

            // Copy all parameters from the original request
            for (const [key, value] of params.entries()) {
                verificationParams.append(key, value);
            }

            // Change mode to check_authentication for verification
            verificationParams.set('openid.mode', 'check_authentication');

            // Send verification request to Steam
            const verificationResponse = await fetch('https://steamcommunity.com/openid/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: verificationParams.toString()
            });

            const responseText = await verificationResponse.text();

            // Check if verification was successful
            if (!responseText.includes('is_valid:true')) {
                console.error('OpenID verification failed: Invalid response from Steam', responseText);
                return null;
            }

            // Extract steamID from the claimed_id
            const claimedId = params.get('openid.claimed_id');
            if (!claimedId) {
                console.error('OpenID verification failed: Missing claimed_id');
                return null;
            }

            // Extract the Steam ID from the claimed_id
            const steamID = claimedId.split('/').pop();
            if (!steamID || !/^\d+$/.test(steamID)) {
                console.error('OpenID verification failed: Invalid steamID format', steamID);
                return null;
            }

            return steamID;
        } catch (error) {
            console.error('OpenID verification error:', error);
            return null;
        }
    }
}