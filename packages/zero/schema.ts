import { Size } from "@nestri/core/src/base-game/base-game.sql";
import { type Limitations } from "@nestri/core/src/steam/steam.sql";
import { ImageColor, ImageDimensions } from "@nestri/core/src/images/images.sql";
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
        username: string(),
        avatar_hash: string(),
        member_since: number(),
        last_synced_at: number(),
        real_name: string().optional(),
        profile_url: string().optional(),
        limitations: json<Limitations>(),
        ...timestamps,
    })
    .primaryKey("id");

const teams = table("teams")
    .columns({
        id: string(),
        name: string(),
        slug: string(),
        owner_id: string(),
        invite_code: string(),
        max_members: number(),
        ...timestamps,
    })
    .primaryKey("id");

const members = table("members")
    .columns({
        role: string(),
        team_id: string(),
        steam_id: string(),
        user_id: string().optional(),
        ...timestamps,
    })
    .primaryKey("team_id", "steam_id");

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
        type: enumeration<"tag" | "genre" | "publisher" | "developer">(),
        ...timestamps
    })
    .primaryKey("category_slug", "base_game_id", "type")

const base_games = table("base_games")
    .columns({
        id: string(),
        slug: string(),
        name: string(),
        release_date: number(),
        size: json<Size>(),
        description: string(),
        primary_genre: string(),
        controller_support: string().optional(),
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
        owner_id: string(),
        ...timestamps
    }).primaryKey("base_game_id", "owner_id")

const images = table("images")
    .columns({
        image_hash: string(),
        base_game_id: string(),
        type: enumeration<"heroArt" | "icon" | "logo" | "superHeroArt" | "poster" | "boxArt" | "screenshot" | "background">(),
        position: number(),
        dimensions: json<ImageDimensions>(),
        extracted_color: json<ImageColor>(),
        ...timestamps
    }).primaryKey("image_hash", "type", "base_game_id", "position")

// Schema and Relationships
export const schema = createSchema({
    tables: [users, steam_accounts, teams, members, friends_list, categories, base_games, games, game_libraries, images],
    relationships: [
        relationships(steam_accounts, (r) => ({
            user: r.one({
                sourceField: ["user_id"],
                destSchema: users,
                destField: ["id"],
            }),
            memberEntries: r.many({
                sourceField: ["id"],
                destSchema: members,
                destField: ["steam_id"],
            }),
            friends: r.many({
                sourceField: ["id"],
                destSchema: friends_list,
                destField: ["steam_id"],
            }),
            friendOf: r.many({
                sourceField: ["id"],
                destSchema: friends_list,
                destField: ["friend_steam_id"],
            }),
            libraries: r.many({
                sourceField: ["id"],
                destSchema: game_libraries,
                destField: ["owner_id"]
            })
        })),
        relationships(users, (r) => ({
            teams: r.many({
                sourceField: ["id"],
                destSchema: teams,
                destField: ["owner_id"],
            }),
            members: r.many({
                sourceField: ["id"],
                destSchema: members,
                destField: ["user_id"],
            }),
            steamAccounts: r.many({
                sourceField: ["id"],
                destSchema: steam_accounts,
                destField: ["user_id"]
            })
        })),
        relationships(teams, (r) => ({
            owner: r.one({
                sourceField: ["owner_id"],
                destSchema: users,
                destField: ["id"],
            }),
            members: r.many({
                sourceField: ["id"],
                destSchema: members,
                destField: ["team_id"],
            }),
        })),
        relationships(members, (r) => ({
            team: r.one({
                sourceField: ["team_id"],
                destSchema: teams,
                destField: ["id"],
            }),
            user: r.one({
                sourceField: ["user_id"],
                destSchema: users,
                destField: ["id"],
            }),
            steamAccount: r.one({
                sourceField: ["steam_id"],
                destSchema: steam_accounts,
                destField: ["id"],
            }),
        })),
        relationships(friends_list, (r) => ({
            steam: r.one({
                sourceField: ["steam_id"],
                destSchema: steam_accounts,
                destField: ["id"],
            }),
            friend: r.one({
                sourceField: ["friend_steam_id"],
                destSchema: steam_accounts,
                destField: ["id"],
            }),
        })),
        relationships(base_games, (r) => ({
            games: r.many({
                sourceField: ["id"],
                destSchema: games,
                destField: ["base_game_id"]
            }),
            libraries: r.many({
                sourceField: ["id"],
                destSchema: game_libraries,
                destField: ["base_game_id"]
            }),
            images: r.many({
                sourceField: ["id"],
                destSchema: images,
                destField: ["base_game_id"]
            })
        })),
        relationships(categories, (r) => ({
            games_slug: r.many({
                sourceField: ["slug"],
                destSchema: games,
                destField: ["category_slug"]
            }),
            games_type: r.many({
                sourceField: ["type"],
                destSchema: games,
                destField: ["type"]
            })
        })),
        relationships(games, (r) => ({
            category_slug: r.one({
                sourceField: ["category_slug"],
                destSchema: categories,
                destField: ["slug"],
            }),
            category_type: r.one({
                sourceField: ["type"],
                destSchema: categories,
                destField: ["type"],
            }),
            base_game: r.one({
                sourceField: ["base_game_id"],
                destSchema: base_games,
                destField: ["id"],
            }),
        })),
        relationships(game_libraries, (r) => ({
            base_game: r.one({
                sourceField: ["base_game_id"],
                destSchema: base_games,
                destField: ["id"],
            }),
            owner: r.one({
                sourceField: ["owner_id"],
                destSchema: steam_accounts,
                destField: ["id"],
            }),
        })),
        relationships(images, (r) => ({
            base_game: r.one({
                sourceField: ["base_game_id"],
                destSchema: base_games,
                destField: ["id"],
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
        members: {
            row: {
                select: [
                    (auth: Auth, q: ExpressionBuilder<Schema, 'members'>) => q.exists("user", (u) => u.where("id", auth.sub)),
                    //allow other team members to view other members
                    (auth: Auth, q: ExpressionBuilder<Schema, 'members'>) => q.exists("team", (u) => u.related("members", (m) => m.where("user_id", auth.sub))),
                ]
            },
        },
        teams: {
            row: {
                select: [
                    (auth: Auth, q: ExpressionBuilder<Schema, 'teams'>) => q.exists("members", (u) => u.where("user_id", auth.sub)),
                ]
            },
        },
        steam_accounts: {
            row: {
                select: [
                    (auth: Auth, q: ExpressionBuilder<Schema, 'steam_accounts'>) => q.exists("user", (u) => u.where("id", auth.sub)),
                    //Allow friends to view friends steam accounts
                    (auth: Auth, q: ExpressionBuilder<Schema, 'steam_accounts'>) => q.exists("friends", (u) => u.related("friend", (f) => f.where("user_id", auth.sub))),
                    //allow other team members to see a user's steam account
                    (auth: Auth, q: ExpressionBuilder<Schema, 'steam_accounts'>) => q.exists("memberEntries", (u) => u.related("team", (t) => t.related("members", (m) => m.where("user_id", auth.sub)))),
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
                    //allow team members to see the other members' libraries
                    (auth: Auth, q: ExpressionBuilder<Schema, 'game_libraries'>) => q.exists("owner", (u) => u.related("memberEntries", (f) => f.where("user_id", auth.sub))),
                    //allow friends to see their friends libraries
                    (auth: Auth, q: ExpressionBuilder<Schema, 'game_libraries'>) => q.exists("owner", (u) => u.related("friends", (f) => f.related("friend", (s) => s.where("user_id", auth.sub)))),
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