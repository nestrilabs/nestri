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
    [depotId: string]: DepotEntry | string | undefined;
    branches: any;
    privatebranches: string;
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
    strGenres: string;
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
    score: number;
    gameid: string;
    releaseDate: Date;
    description: string;
    compatibility: "low" | "mid" | "high" | "unknown";
    controllerSupport: "partial" | "full" | "unknown";
    primaryGenre: string | null;
    size: { downloadSize: number; sizeOnDisk: number };
    tags: Array<{ name: string; slug: string; type: "tag" }>;
    genres: Array<{ type: "genre"; name: string; slug: string }>;
    developers: Array<{ name: string; slug: string; type: "developer" }>;
    publishers: Array<{ name: string; slug: string; type: "publisher" }>;
}