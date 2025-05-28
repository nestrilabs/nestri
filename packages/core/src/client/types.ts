export interface SteamApp {
    /** Steam application ID */
    appid: number;

    /** Array of Steam IDs that own this app */
    owner_steamids: string[];

    /** Name of the game/application */
    name: string;

    /** Filename of the game's capsule image */
    capsule_filename: string;

    /** Hash value for the game's icon */
    img_icon_hash: string;

    /** Reason code for exclusion (0 indicates no exclusion) */
    exclude_reason: number;

    /** Unix timestamp when the app was acquired */
    rt_time_acquired: number;

    /** Unix timestamp when the app was last played */
    rt_last_played: number;

    /** Total playtime in seconds */
    rt_playtime: number;

    /** Type identifier for the app (1 = game) */
    app_type: number;

    /** Array of content descriptor IDs */
    content_descriptors?: number[];
}

export interface SteamApiResponse {
    response: {
        apps: SteamApp[];
        owner_steamid: string;
    };
}

export interface SteamAppDataResponse {
    data: Record<string, SteamAppEntry>;
    status: string;
}

export interface SteamAppEntry {
    _change_number: number;
    _missing_token: boolean;
    _sha: string;
    _size: number;
    appid: string;
    common: CommonData;
    config: AppConfig;
    depots: AppDepots;
    extended: AppExtended;
    ufs: UFSData;
}

export interface CommonData {
    associations: Record<string, { name: string; type: string }>;
    category: Record<string, string>;
    clienticon: string;
    clienttga: string;
    community_hub_visible: string;
    community_visible_stats: string;
    content_descriptors: Record<string, string>;
    controller_support?: string;
    controllertagwizard: string;
    gameid: string;
    genres: Record<string, string>;
    header_image: Record<string, string>;
    icon: string;
    languages: Record<string, string>;
    library_assets: LibraryAssets;
    library_assets_full: LibraryAssetsFull;
    metacritic_fullurl: string;
    metacritic_name: string;
    metacritic_score: string;
    name: string;
    name_localized: Partial<Record<LanguageCode, string>>;
    osarch: string;
    osextended: string;
    oslist: string;
    primary_genre: string;
    releasestate: string;
    review_percentage: string;
    review_score: string;
    small_capsule: Record<string, string>;
    steam_deck_compatibility: SteamDeckCompatibility;
    steam_release_date: string;
    store_asset_mtime: string;
    store_tags: Record<string, string>;
    supported_languages: Record<
        string,
        {
            full_audio?: string;
            subtitles?: string;
            supported?: string;
        }
    >;
    type: string;
}

export interface LibraryAssets {
    library_capsule: string;
    library_header: string;
    library_hero: string;
    library_logo: string;
    logo_position: LogoPosition;
}

export interface LogoPosition {
    height_pct: string;
    pinned_position: string;
    width_pct: string;
}

export interface LibraryAssetsFull {
    library_capsule: ImageSet;
    library_header: ImageSet;
    library_hero: ImageSet;
    library_logo: ImageSet & { logo_position: LogoPosition };
    [key: string]: any
}

export interface ImageSet {
    image: Record<string, string>;
    image2x?: Record<string, string>;
}

export interface SteamDeckCompatibility {
    category: string;
    configuration: Record<string, string>;
    test_timestamp: string;
    tested_build_id: string;
    tests: Record<string, { display: string; token: string }>;
}

export interface AppConfig {
    installdir: string;
    launch: Record<
        string,
        {
            executable: string;
            type: string;
            arguments?: string;
            description?: string;
            description_loc?: Record<string, string>;
            config?: {
                betakey: string;
            };
        }
    >;
    steamcontrollertemplateindex: string;
    steamdecktouchscreen: string;
}

export interface AppDepots {
    branches: AppDepotBranches;
    privatebranches: Record<string, AppDepotBranches>;
    [depotId: string]: DepotEntry
    | AppDepotBranches
    | Record<string, AppDepotBranches>;
}


export interface DepotEntry {
    manifests: {
        public: {
            download: string;
            gid: string;
            size: string;
        };
    };
}

export interface AppDepotBranches {
    [branchName: string]: {
        buildid: string;
        timeupdated: string;
    };
}

export interface AppExtended {
    additional_dependencies: Array<{
        dest_os: string;
        h264: string;
        src_os: string;
    }>;
    developer: string;
    dlcavailableonstore: string;
    homepage: string;
    listofdlc: string;
    publisher: string;
}

export interface UFSData {
    maxnumfiles: string;
    quota: string;
    savefiles: Array<{
        path: string;
        pattern: string;
        recursive: string;
        root: string;
    }>;
}

export type LanguageCode =
    | "english"
    | "french"
    | "german"
    | "italian"
    | "japanese"
    | "koreana"
    | "polish"
    | "russian"
    | "schinese"
    | "tchinese"
    | "brazilian"
    | "spanish";

export interface Screenshot {
    appid: number;
    id: number;
    filename: string;
    all_ages: string;
    normalized_name: string;
}

export interface Category {
    strDisplayName: string;
}

export interface ReviewSummary {
    strReviewSummary: string;
    cReviews: number;
    cRecommendationsPositive: number;
    cRecommendationsNegative: number;
    nReviewScore: number;
}

export interface GameDetailsResponse {
    strReleaseDate: string;
    strDescription: string;
    rgScreenshots: Screenshot[];
    rgCategories: Category[];
    strGenres?: string;
    strFullDescription: string;
    strMicroTrailerURL: string;
    ReviewSummary: ReviewSummary;
}

// Define the TypeScript interfaces
export interface Tag {
    tagid: number;
    name: string;
}

export interface TagWithSlug {
    name: string;
    slug: string;
    type: string;
}

export interface StoreTags {
    [key: string]: string; // Index signature for numeric string keys to tag ID strings
}


export interface GameTagsResponse {
    tags: Tag[];
    success: number;
    rwgrsn: number;
}

export type GenreType = {
    type: 'genre';
    name: string;
    slug: string;
};

export interface AppInfo {
    name: string;
    slug: string;
    images: {
        logo: string;
        backdrop: string;
        poster: string;
        banner: string;
        screenshots: string[];
        icon: string;
    }
    links: string[] | null;
    score: number;
    id: string;
    releaseDate: Date;
    description: string | null;
    compatibility: "low" | "mid" | "high" | "unknown";
    controllerSupport: "partial" | "full" | "unknown";
    primaryGenre: string | null;
    size: { downloadSize: number; sizeOnDisk: number };
    tags: Array<{ name: string; slug: string; type: "tag" }>;
    genres: Array<{ type: "genre"; name: string; slug: string }>;
    categories: Array<{ name: string; slug: string; type: "categorie" }>;
    franchises: Array<{ name: string; slug: string; type: "franchise" }>;
    developers: Array<{ name: string; slug: string; type: "developer" }>;
    publishers: Array<{ name: string; slug: string; type: "publisher" }>;
}

export type ImageType =
    | 'screenshot'
    | 'boxArt'
    | 'banner'
    | 'backdrop'
    | 'icon'
    | 'logo'
    | 'poster'
    | 'heroArt';

export interface ImageInfo {
    type: ImageType;
    position: number;
    hash: string;
    sourceUrl: string | null;
    format?: string;
    averageColor: { hex: string; isDark: boolean };
    dimensions: { width: number; height: number };
    fileSize: number;
    buffer: Buffer;
}

export interface CompareOpts {
    /** Pixelmatch color threshold (0–1). Default: 0.1 */
    threshold?: number;
    /** If true, return an image buffer of the diff map. Default: false */
    diffOutput?: boolean;
}

export interface CompareResult {
    diffRatio: number;
    /** Present only if `diffOutput: true` */
    diffBuffer?: Buffer;
}

export interface Shot {
    url: string;
    buffer: Buffer;
}

export interface RankedShot {
    url: string;
    score: number;
}

export interface SteamPlayerSummaryResponse {
    response: {
        players: SteamPlayerSummary[];
    };
}

export interface SteamPlayerSummary {
    steamid: string;
    communityvisibilitystate: number;
    profilestate?: number;
    personaname: string;
    profileurl: string;
    avatar: string;
    avatarmedium: string;
    avatarfull: string;
    avatarhash: string;
    lastlogoff?: number;
    personastate: number;
    realname?: string;
    primaryclanid?: string;
    timecreated: number;
    personastateflags?: number;
    loccountrycode?: string;
}

export interface SteamPlayerBansResponse {
    players: SteamPlayerBan[];
}

export interface SteamPlayerBan {
    SteamId: string;
    CommunityBanned: boolean;
    VACBanned: boolean;
    NumberOfVACBans: number;
    DaysSinceLastBan: number;
    NumberOfGameBans: number;
    EconomyBan: 'none' | 'probation' | 'banned'; // Enum based on known possible values
}

export type SteamAccount = {
    id: string;
    name: string;
    realName: string | null;
    steamMemberSince: Date;
    avatarHash: string;
    limitations: {
        isLimited: boolean;
        tradeBanState: 'none' | 'probation' | 'banned';
        isVacBanned: boolean;
        visibilityState: number;
        privacyState: 'public' | 'private' | 'friendsonly';
    };
    profileUrl: string;
    lastSyncedAt: Date;
};

export interface SteamFriendsListResponse {
    friendslist: {
        friends: SteamFriend[];
    };
}

export interface SteamFriend {
    steamid: string;
    relationship: 'friend'; // could expand this if Steam ever adds more types
    friend_since: number; // Unix timestamp (seconds)
}

export interface SteamOwnedGamesResponse {
    response: {
        game_count: number;
        games: SteamOwnedGame[];
    };
}

export interface SteamOwnedGame {
    appid: number;
    name: string;
    playtime_forever: number;
    img_icon_url: string;

    playtime_windows_forever?: number;
    playtime_mac_forever?: number;
    playtime_linux_forever?: number;
    playtime_deck_forever?: number;

    rtime_last_played?: number; // Unix timestamp
    content_descriptorids?: number[];
    playtime_disconnected?: number;
    has_community_visible_stats?: boolean;
}

/**
 * The shape of the parsed Steam profile information.
 */
export interface ProfileInfo {
    steamID64: string;
    isLimited: boolean;
    privacyState: 'public' | 'private' | 'friendsonly' | string;
    visibility: string;
}

export interface SteamStoreResponse {
    response: {
        store_items: SteamStoreItem[];
    };
}

export interface SteamStoreItem {
    item_type: number;
    id: number;
    success: number;
    visible: boolean;
    name: string;
    store_url_path: string;
    appid: number;
    type: number;
    tagids: number[];
    categories: {
        supported_player_categoryids?: number[];
        feature_categoryids?: number[];
        controller_categoryids?: number[];
    };
    reviews: {
        summary_filtered: {
            review_count: number;
            percent_positive: number;
            review_score: number;
            review_score_label: string;
        };
    };
    basic_info: {
        short_description?: string;
        publishers: SteamCreator[];
        developers: SteamCreator[];
        franchises?: SteamCreator[];
    };
    tags: {
        tagid: number;
        weight: number;
    }[];
    assets: SteamAssets;
    assets_without_overrides: SteamAssets;
    release: {
        steam_release_date: number;
    };
    platforms: {
        windows: boolean;
        mac: boolean;
        steamos_linux: boolean;
        vr_support: Record<string, never>;
        steam_deck_compat_category?: number;
        steam_os_compat_category?: number;
    };
    best_purchase_option: PurchaseOption;
    purchase_options: PurchaseOption[];
    screenshots: {
        all_ages_screenshots: {
            filename: string;
            ordinal: number;
        }[];
    };
    trailers: {
        highlights: Trailer[];
    };
    supported_languages: SupportedLanguage[];
    full_description: string;
    links?: {
        link_type: number;
        url: string;
    }[];
}

export interface SteamCreator {
    name: string;
    creator_clan_account_id: number;
}

export interface SteamAssets {
    asset_url_format: string;
    main_capsule: string;
    small_capsule: string;
    header: string;
    page_background: string;
    hero_capsule: string;
    hero_capsule_2x: string;
    library_capsule: string;
    library_capsule_2x: string;
    library_hero: string;
    library_hero_2x: string;
    community_icon: string;
    page_background_path: string;
    raw_page_background: string;
}

export interface PurchaseOption {
    packageid?: number;
    bundleid?: number;
    purchase_option_name: string;
    final_price_in_cents: string;
    original_price_in_cents: string;
    formatted_final_price: string;
    formatted_original_price: string;
    discount_pct: number;
    active_discounts: ActiveDiscount[];
    user_can_purchase_as_gift: boolean;
    hide_discount_pct_for_compliance: boolean;
    included_game_count: number;
    bundle_discount_pct?: number;
    price_before_bundle_discount?: string;
    formatted_price_before_bundle_discount?: string;
}

export interface ActiveDiscount {
    discount_amount: string;
    discount_description: string;
    discount_end_date: number;
}

export interface Trailer {
    trailer_name: string;
    trailer_url_format: string;
    trailer_category: number;
    trailer_480p: TrailerFile[];
    trailer_max: TrailerFile[];
    microtrailer: TrailerFile[];
    screenshot_medium: string;
    screenshot_full: string;
    trailer_base_id: number;
    all_ages: boolean;
}

export interface TrailerFile {
    filename: string;
    type: string;
}

export interface SupportedLanguage {
    elanguage: number;
    eadditionallanguage: number;
    supported: boolean;
    full_audio: boolean;
    subtitles: boolean;
}
