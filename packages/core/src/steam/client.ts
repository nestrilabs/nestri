import { z } from "zod";
import { fn } from "../utils";
import { Steam } from "./index"
import {
    SteamGameInfo,
    UserDataResponse,
    AppDetailsResponse,
    GetFriendsResponse,
    GameUserInfoResponse,
    GamesCompatListResponse,
    LibraryAppDetailsResponse,
} from "./types";
import { EAuthTokenPlatformType, LoginSession } from "steam-session";

export const API_HEADERS = {
    accept: 'application/json, text/plain, */*',
    'sec-fetch-site': 'cross-site',
    'sec-fetch-mode': 'cors',
    'sec-fetch-dest': 'empty'
};

export namespace SteamClient {
    export const getUserData = fn(
        Steam.Credential
            .pick({ accessToken: true })
            .extend({
                steamIDs: z.bigint().array()
            }),
        async (input) => {
            const steamIDs = input.steamIDs.map(i => i.toString()).join(",")
            const response = await fetch(`https://api.steampowered.com/ISteamUserOAuth/GetUserSummaries/v0001?access_token=${input.accessToken}&steamids=${steamIDs}`, {
                method: "GET",
                headers: {
                    ...API_HEADERS,
                    "User-Agent": "Steam 1291812 / iPhone",
                    "Accept-Language": "en-us",
                }
            })

            if (!response.ok) {
                throw new Error(`Steam API error: ${response.status} ${response.statusText}`);
            }

            return await response.json() as UserDataResponse
        }
    )

    export const getFriends = fn(
        Steam.Credential
            .pick({ accessToken: true })
            .extend({
                steamIDs: z.bigint().array()
            }),
        async (input) => {
            const steamIDs = input.steamIDs.map(i => i.toString()).join(",")
            const response = await fetch(`https://api.steampowered.com/ISteamUserOAuth/GetFriendList/v0001?access_token=${input.accessToken}&steamids=${steamIDs}`, {
                method: "GET",
                headers: {
                    ...API_HEADERS,
                    "User-Agent": "Steam 1291812 / iPhone",
                    "Accept-Language": "en-us",
                }
            })

            if (!response.ok) {
                throw new Error(`Steam API error: ${response.status} ${response.statusText}`);
            }

            return await response.json() as GetFriendsResponse
        }
    )

    export const getOwnedGamesCompatList = fn(
        Steam.Credential
            .pick({ cookies: true }),
        async (input) => {
            const games = await fetchApi<GamesCompatListResponse>(`/saleaction/ajaxgetuserdeckcompatlist?appListType=library`, input.cookies.join('; '))

            //For now we are showing the playable and verified list of games only... 
            //TODO: Maybe add the unknownList as well? Maybe when we have the bandwidth to play around with Proton
            return [...games.list.playableList, ...games.list.verifiedList]
        }
    )

    export const getGameUserInfo = fn(
        Steam.Credential
            .pick({ cookies: true })
            .extend({ gameID: z.number() }),
        async (input) => {
            const cookies = input.cookies.join('; ');

            return await fetchApi<GameUserInfoResponse>(`/api/appuserdetails?appids=${input.gameID}`, cookies)
        }
    )

    export const getGameInfo = fn(
        Steam.Credential
            .pick({ cookies: true })
            .extend({ gameID: z.number() }),
        async (input) => {
            const cookies = input.cookies.join('; ');

            const [libraryDetailsResult, appDetailsResult, steamGameInfo] = await Promise.allSettled([
                fetchApi<LibraryAppDetailsResponse>(`/api/libraryappdetails/?appid=${input.gameID}`, cookies),
                fetchApi<AppDetailsResponse>(`/api/appdetails/?appids=${input.gameID}`, cookies),
                fetchSteamCMD(input.gameID)
            ]);

            if (appDetailsResult.status === 'fulfilled') {
                const response = appDetailsResult.value;
                const gameInfo = response[input.gameID.toString()].data
                if (response[input.gameID.toString()] && response[input.gameID.toString()].success && gameInfo) {
                    return {
                        name: gameInfo.name,
                        genres: gameInfo.genres,
                        isFree: gameInfo.is_free,
                        website: gameInfo.website,
                        steamAppID: gameInfo.steam_appid,
                        legalNotice: gameInfo.legal_notice,
                        releaseDate: gameInfo.release_date,
                        description: gameInfo.short_description,
                        nativeLinux: gameInfo.platforms.linux,
                        achievements: gameInfo.achievements,
                        isSinglePlayer: !!gameInfo.categories.find(i => i.description.includes("Single-player")),
                        supportsFamilySharing: !!gameInfo.categories.find(i => i.description.includes("Family Sharing")),
                        pegi: {
                            rating: gameInfo.ratings.pegi.rating,
                            description: gameInfo.ratings.pegi.descriptors,
                            requiredAge: gameInfo.ratings.pegi.required_age ? Number(gameInfo.ratings.pegi.required_age) : Number(gameInfo.required_age)
                        },
                        protonCompatibility: steamGameInfo.status === "fulfilled" ? steamGameInfo.value.common.steam_deck_compatibility : null,
                        controllerSupport: gameInfo.controller_support,
                        systemRequirements: gameInfo.platforms.linux ? gameInfo.linux_requirements : gameInfo.pc_requirements,
                        publishers: libraryDetailsResult.status === "fulfilled" ? libraryDetailsResult.value.rgPublishers : null,
                        developers: libraryDetailsResult.status === "fulfilled" ? libraryDetailsResult.value.rgDevelopers : null,
                    }
                }
            }

            return null
        }
    )

    // export const getGameImages = fn(
    //
    // )

    export const generateCookies = fn(
        Steam.Credential
            .pick({ refreshToken: true }),
        async (input) => {
            let webSession = new LoginSession(EAuthTokenPlatformType.WebBrowser);
            webSession.refreshToken = input.refreshToken

            return await webSession.getWebCookies()
        }
    )

    export const generateAccessToken = fn(
        Steam.Credential
            .pick({ refreshToken: true }),
        async (input) => {
            let clientSession = new LoginSession(EAuthTokenPlatformType.SteamClient);
            clientSession.refreshToken = input.refreshToken

            await clientSession.refreshAccessToken();

            return clientSession.accessToken
        }
    )

    const fetchApi = async <T>(path: string, cookies: string): Promise<T> => {
        const response = await fetch(`https://store.steampowered.com${path}`, {
            method: "GET",
            headers: {
                ...API_HEADERS,
                "User-Agent": "Steam 1291812 / iPhone",
                "Accept-Language": "en-us",
                "Cookie": cookies
            }
        });

        if (!response.ok) {
            throw new Error(`Steam API error: ${response.status} ${response.statusText}`);
        }

        return await response.json() as T;
    };

    const fetchSteamCMD = async (steamID: number) => {
        const response = await fetch(`https://api.steamcmd.net/v1/info/${steamID}`, {
            method: "GET",
            headers: {
                ...API_HEADERS,
                "User-Agent": "Steam 1291812 / iPhone",
                "Accept-Language": "en-us",
            }
        });

        if (!response.ok) {
            throw new Error(`Steam API error: ${response.status} ${response.statusText}`);
        }

        return await response.json() as SteamGameInfo;
    };
}