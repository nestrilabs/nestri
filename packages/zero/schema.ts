import type { Limitations } from "@nestri/core/src/steam/steam.sql";
import type { Size, Links } from "@nestri/core/src/base-game/base-game.sql";
import type { ImageColor, ImageDimensions } from "@nestri/core/src/images/images.sql";
import {
    json,
    table,
    number,
    string,
    enumeration,
    createSchema,
    relationships,
    definePermissions,
    type ExpressionBuilder,
} from "@rocicorp/zero";

const timestamps = {
    time_created: number(),
    time_deleted: number().optional(),
} as const;

// Table Definitions
const users = table("users")
    .columns({
        id: string(),
        name: string(),
        email: string(),
        last_login: number(),
        avatar_url: string().optional(),
        polar_customer_id: string().optional(),
        ...timestamps
    })
    .primaryKey("id");

const steam_accounts = table("steam_accounts")
    .columns({
        id: string(),
        name: string(),
        status: string(),
        user_id: string(),
        avatar_hash: string(),
        member_since: number(),
        last_synced_at: number(),
        real_name: string().optional(),
        profile_url: string().optional(),
        limitations: json<Limitations>(),
        ...timestamps,
    })
    .primaryKey("id");

const friends_list = table("friends_list")
    .columns({
        steam_id: string(),
        friend_steam_id: string(),
        ...timestamps,
    })
    .primaryKey("steam_id", "friend_steam_id");

const games = table("games")
    .columns({
        base_game_id: string(),
        category_slug: string(),
        type: enumeration<"tag" | "genre" | "publisher" | "developer" | "categorie" | "franchise">(),
        ...timestamps
    })
    .primaryKey("category_slug", "base_game_id", "type")

const base_games = table("base_games")
    .columns({
        id: string(),
        slug: string(),
        name: string(),
        // This should be an array, and i dunno how to include it here
        size: json<Size>(),
        release_date: number(),
        links: json<Links>().optional(),
        description: string().optional(),
        primary_genre: string().optional(),
        controller_support: enumeration<"full" | "partial" | "unknown">(),
        compatibility: enumeration<"high" | "mid" | "low" | "unknown">(),
        score: number(),
        ...timestamps
    })
    .primaryKey("id")

const categories = table("categories")
    .columns({
        slug: string(),
        type: enumeration<"tag" | "genre" | "publisher" | "developer">(),
        name: string(),
        ...timestamps
    })
    .primaryKey("slug", "type")

const game_libraries = table("game_libraries")
    .columns({
        base_game_id: string(),
        total_playtime: number(),
        owner_steam_id: string(),
        last_played: number().optional(),
        ...timestamps
    }).primaryKey("base_game_id", "owner_steam_id")

const images = table("images")
    .columns({
        image_hash: string(),
        base_game_id: string(),
        type: enumeration<"heroArt" | "icon" | "logo" | "superHeroArt" | "poster" | "boxArt" | "screenshot" | "background">(),
        position: number(),
        dimensions: json<ImageDimensions>(),
        extracted_color: json<ImageColor>(),
        ...timestamps
    }).primaryKey("image_hash")

// Schema and Relationships
export const schema = createSchema({
    tables: [users, steam_accounts, friends_list, categories, base_games, games, game_libraries, images],
    relationships: [
        relationships(steam_accounts, (r) => ({
            user: r.one({
                sourceField: ["user_id"],
                destSchema: users,
                destField: ["id"],
            }),
            friends: r.many(
                {
                    sourceField: ["id"],
                    destSchema: friends_list,
                    destField: ["steam_id"],
                },
                {
                    sourceField: ["friend_steam_id"],
                    destSchema: steam_accounts,
                    destField: ["id"],
                }
            ),
            libraryGames: r.many(
                {
                    sourceField: ["id"],
                    destSchema: game_libraries,
                    destField: ["owner_steam_id"],
                },
                {
                    sourceField: ["base_game_id"],
                    destSchema: base_games,
                    destField: ["id"],
                }
            ),
        })),
        relationships(users, (r) => ({
            steamAccounts: r.many({
                sourceField: ["id"],
                destSchema: steam_accounts,
                destField: ["user_id"]
            })
        })),
        relationships(base_games, (r) => ({
            libraryOwners: r.many(
                {
                    sourceField: ["id"],
                    destSchema: game_libraries,
                    destField: ["base_game_id"],
                },
                {
                    sourceField: ["owner_steam_id"],
                    destSchema: steam_accounts,
                    destField: ["id"],
                }
            ),
            categories: r.many(
                {
                    sourceField: ["id"],
                    destSchema: games,
                    destField: ["base_game_id"],
                },
                {
                    sourceField: ["category_slug", "type"],
                    destSchema: categories,
                    destField: ["slug", "type"],
                }
            ),
            images: r.many({
                sourceField: ["id"],
                destSchema: images,
                destField: ["base_game_id"]
            })
        })),
        relationships(categories, (r) => ({
            baseGames: r.many(
                {
                    sourceField: ["slug", "type"],
                    destSchema: games,
                    destField: ["category_slug", "type"],
                },
                {
                    sourceField: ["base_game_id"],
                    destSchema: base_games,
                    destField: ["id"],
                }
            ),
        })),
        relationships(images, (r) => ({
            base_game: r.one({
                sourceField: ["base_game_id"],
                destSchema: base_games,
                destField: ["id"],
            }),
        })),
        //Junction tables
        relationships(friends_list, (r) => ({
            steam: r.one({
                sourceField: ["steam_id"],
                destSchema: steam_accounts,
                destField: ["id"]
            }),
            friend: r.one({
                sourceField: ["friend_steam_id"],
                destSchema: steam_accounts,
                destField: ["id"]
            }),
        })),

        relationships(game_libraries, (r) => ({
            owner: r.one({
                sourceField: ["owner_steam_id"],
                destSchema: steam_accounts,
                destField: ["id"]
            }),
            baseGame: r.one({
                sourceField: ["base_game_id"],
                destSchema: base_games,
                destField: ["id"]
            }),
        })),

        relationships(games, (r) => ({
            baseGame: r.one({
                sourceField: ["base_game_id"],
                destSchema: base_games,
                destField: ["id"]
            }),
            category: r.one({
                sourceField: ["category_slug", "type"],
                destSchema: categories,
                destField: ["slug", "type"]
            }),
        })),
    ],
});

export type Schema = typeof schema;

type Auth = {
    sub: string;
    properties: {
        userID: string;
        email: string;
    };
};

export const permissions = definePermissions<Auth, Schema>(schema, () => {
    return {
        steam_accounts: {
            row: {
                select: [
                    (auth: Auth, q: ExpressionBuilder<Schema, 'steam_accounts'>) => q.exists("user", (u) => u.where("id", auth.sub)),
                    //Allow friends to view friends steam accounts
                    (auth: Auth, q: ExpressionBuilder<Schema, 'steam_accounts'>) => q.exists("friends", (u) => u.where("user_id", auth.sub)),
                ]
            },
        },
        users: {
            row: {
                select: [
                    (auth: Auth, q: ExpressionBuilder<Schema, 'users'>) => q.cmp("id", "=", auth.sub),
                ]
            },
        },
        friends_list: {
            row: {
                select: [
                    (auth: Auth, q: ExpressionBuilder<Schema, 'friends_list'>) => q.exists("steam", (u) => u.where("user_id", auth.sub)),
                    (auth: Auth, q: ExpressionBuilder<Schema, 'friends_list'>) => q.exists("friend", (u) => u.where("user_id", auth.sub)),
                ]
            },
        },
        game_libraries: {
            row: {
                select: [
                    (auth: Auth, q: ExpressionBuilder<Schema, 'game_libraries'>) => q.exists("owner", (u) => u.where("user_id", auth.sub)),
                    //allow friends to see their friends libraries
                    (auth: Auth, q: ExpressionBuilder<Schema, 'game_libraries'>) => q.exists("owner", (u) => u.related("friends", (f) => f.where("user_id", auth.sub))),
                ]
            }
        },
        // Games are publicly viewable - but only to logged in users
        games: {
            row: {
                select: [(auth: Auth, q: ExpressionBuilder<Schema, 'games'>) => q.cmpLit(auth.sub, "IS NOT", null),]
            }
        },
        base_games: {
            row: {
                select: [(auth: Auth, q: ExpressionBuilder<Schema, 'base_games'>) => q.cmpLit(auth.sub, "IS NOT", null),]
            }
        },
        categories: {
            row: {
                select: [(auth: Auth, q: ExpressionBuilder<Schema, 'categories'>) => q.cmpLit(auth.sub, "IS NOT", null),]
            }
        },
        images: {
            row: {
                select: [(auth: Auth, q: ExpressionBuilder<Schema, 'images'>) => q.cmpLit(auth.sub, "IS NOT", null),]
            }
        },
    };
});