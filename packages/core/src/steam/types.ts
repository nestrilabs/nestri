export type UserDataResponse = {
    players: [
        {
            steamid: string;
            communityvisibilitystate: number;
            profilestate: number;
            personaname: string;
            profileurl: string;
            commentpermission?: number;
            avatar: string;
            avatarmedium: string;
            avatarfull: string;
            avatarhash: string;
            lastlogoff: number;
            personastate: number;
            realname: string;
            primaryclanid: string;
            timecreated: number;
            personastateflags: number;
            loccountrycode?: string;
            locstatecode?: string;
        }
    ];
}

export type GamesCompatListResponse = {
    success: number;
    list: {
        unknownList: number[];
        verifiedList: number[];
        playableList: number[];
        unsupportedList: number[];
    }
}

export type GameUserInfoResponse = {
    string: {
        success: boolean;
        data: {
            friendsown?: {
                steamid: string;
                playtime_twoweeks: number;
                playtime_total: number;
            }[];
            recommendations: {
                totalfriends: number;
            };
            added_to_wishlist: boolean;
            is_owned: boolean;
        };
    };
}

export type GetFriendsResponse = {
    friends: {
        steamid: string;
        relationship: "friend" | "unknown";
        friend_since: 1720933937;
    }[]
}

export type LibraryAppDetailsResponse = {
    status: number;
    appid: string;
    name: string;
    strFullDescription: string;
    strSnippet: string;
    rgDevelopers: {
        name: string;
        url: string;
    }[];
    rgPublishers: {
        name: string;
        url: string;
    }[];
    rgFranchises: {
        name: string;
        url: string | null;
    }[];
    rgSocialMedia: []
}

export type AppDetailsResponse = {
    [appid: string]: {
        success: boolean;
        data?: {
            type: "game";
            name: string;
            steam_appid: number;
            required_age: number | string;
            is_free: boolean;
            controller_support: "full";
            dlc: number[];
            detailed_description: string;
            about_the_game: string;
            short_description: string;
            supported_languages: string;
            header_image: string;
            capsule_image: string;
            website: string;
            pc_requirements: {
                minimum: string;
                recommended: string;
            };
            mac_requirements: {
                minimum: string;
                recommended: string;
            };
            linux_requirements: {
                minimum: string;
                recommended: string;
            };
            legal_notice: string;
            developers: string[];
            publishers: string[];
            packages: number[];
            platforms: {
                windows: boolean;
                mac: boolean;
                linux: boolean;
            };
            metacritic?: {
                score: number;
                url: string;
            };
            categories: {
                id: number;
                description: string;
            }[];
            genres: {
                id: string;
                description: string;
            }[];
            screenshots: {
                id: number;
                path_thumbnail: string;
                path_full: string;
            }[];
            movies: {

                id: number;
                name: string;
                thumbnail: string;
                webm: {
                    "480": string;
                    max: string;
                };
                mp4: {
                    "480": string;
                    max: string;
                };
                highlight: boolean;
            }[];
            achievements: {
                total: number;
                highlighted: {
                    name: string;
                    path: string;
                }[]
            };
            release_date: {
                coming_soon: boolean;
                date: string;
            };
            support_info: {
                url: string;
                email: string;
            };
            content_descriptors?: {
                ids: number[];
                notes: string;
            };
            ratings: {
                esrb: {
                    rating: string;
                    descriptors: string;
                    use_age_gate: string;
                    required_age: string;
                    interactive_elements: string;
                },
                pegi: {
                    rating: string;
                    descriptors: string;
                    use_age_gate?: string;
                    required_age?: string;
                },
            }
        }
    }
}

export interface SteamGameInfoResponse {
    data: {
        [appId: string]: SteamGameInfo;
    };
    status: string;
}

// Main game info structure
export interface SteamGameInfo {
    _change_number: number;
    _missing_token: boolean;
    _sha: string;
    _size: number;
    appid: string;
    common: SteamGameCommonInfo;
    config: SteamGameConfig;
    depots: SteamGameDepots;
    extended: SteamGameExtended;
    ufs: SteamGameUFS;
}

// Common game information
export interface SteamGameCommonInfo {
    associations: {
        [key: string]: {
            name: string;
            type: string;
        };
    };
    category: {
        [key: string]: string;
    };
    clienticon: string;
    clienttga: string;
    community_hub_visible: string;
    community_visible_stats: string;
    content_descriptors: {
        [key: string]: string;
    };
    controller_support?: string;
    controllertagwizard?: string;
    eulas: {
        [key: string]: {
            id: string;
            name: string;
            url: string;
            version: string;
        };
    };
    gameid: string;
    genres: {
        [key: string]: string;
    };
    header_image: {
        [language: string]: string;
    };
    icon: string;
    languages: {
        [language: string]: string;
    };
    library_assets: {
        library_capsule: string;
        library_hero: string;
        library_logo: string;
        logo_position: {
            height_pct: string;
            pinned_position: string;
            width_pct: string;
        };
    };
    library_assets_full: {
        library_capsule: {
            image: {
                [language: string]: string;
            };
            image2x: {
                [language: string]: string;
            };
        };
        library_hero: {
            image: {
                [language: string]: string;
            };
            image2x: {
                [language: string]: string;
            };
        };
        library_logo: {
            image: {
                [language: string]: string;
            };
            image2x: {
                [language: string]: string;
            };
            logo_position: {
                height_pct: string;
                pinned_position: string;
                width_pct: string;
            };
        };
    };
    logo: string;
    logo_small: string;
    metacritic_fullurl?: string;
    metacritic_name?: string;
    metacritic_score?: string;
    name: string;
    osarch?: string;
    osextended?: string;
    oslist: string;
    primary_genre: string;
    releasestate: string;
    review_percentage?: string;
    review_score?: string;
    small_capsule: {
        [language: string]: string;
    };
    steam_deck_compatibility?: {
        category: string;
        configuration: {
            [key: string]: string;
        };
        test_timestamp: string;
        tested_build_id: string;
        tests: {
            [key: string]: {
                display: string;
                token: string;
            };
        };
    };
    steam_release_date: string;
    store_asset_mtime: string;
    store_tags: {
        [key: string]: string;
    };
    supported_languages: {
        [language: string]: {
            full_audio?: string;
            subtitles?: string;
            supported: string;
        };
    };
    type: string;
}

// Game configuration
export interface SteamGameConfig {
    app_mappings?: {
        [key: string]: {
            branch: string;
            platform: string;
            tool: string;
        };
    };
    installdir: string;
    launch: {
        [key: string]: {
            config?: {
                oslist?: string;
                betakey?: string;
                steamdeck?: string;
            };
            description?: string;
            description_loc?: {
                [language: string]: string;
            };
            executable: string;
            type?: string;
            workingdir?: string;
        };
    };
    steamcontrollertemplateindex?: string;
    steamdecktouchscreen?: string;
}

// Game depots information
export interface SteamGameDepots {
    [depotId: string]: {
        config?: {
            oslist?: string;
            language?: string;
            osarch?: string;
            optionaldlc?: string;
            steamdeck?: string;
        };
        depotfromapp?: string;
        sharedinstall?: string;
        dlcappid?: string;
        manifests?: {
            [branch: string]: {
                download: string;
                gid: string;
                size: string;
            };
        };
    } | string;
    appmanagesdlc: string;
    baselanguages: string;
    branches: {
        [branch: string]: {
            buildid: string;
            description?: string;
            timeupdated: string;
        };
    };
    privatebranches: string;
}

// Extended game information
export interface SteamGameExtended {
    absolutemousecoordinates: string;
    developer: string;
    dlcavailableonstore: string;
    homepage: string;
    listofdlc: string;
    publisher: string;
    remoteplaytogethertestingbranches?: string;
}

// User file system limits
export interface SteamGameUFS {
    maxnumfiles: string;
    quota: string;
}