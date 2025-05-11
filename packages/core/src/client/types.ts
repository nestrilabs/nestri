/**
 * Steam API Response Types
 */

/**
 * Represents a Steam application/game
 */
interface SteamApp {
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

interface SteamApiResponse {
    response: {
        apps: SteamApp[];
        owner_steamid: string;
    };
}

export type { SteamApiResponse, SteamApp };