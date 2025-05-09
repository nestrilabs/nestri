import { type Limitations } from "@nestri/core/src/steam/steam.sql";
import {
    json,
    table,
    number,
    string,
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
        name: string(),
        status: string(),
        user_id: string(),
        username: string(),
        steam_id: string(),
        avatar_hash: string(),
        member_since: number(),
        last_synced_at: number(),
        real_name: string().optional(),
        profile_url: string().optional(),
        limitations: json<Limitations>(),
        ...timestamps,
    })
    .primaryKey("steam_id");

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

// Schema and Relationships
export const schema = createSchema({
    tables: [users, steam_accounts, teams, members, friends_list],
    relationships: [
        relationships(steam_accounts, (r) => ({
            user: r.one({
                sourceField: ["user_id"],
                destSchema: users,
                destField: ["id"],
            }),
            memberEntries: r.many({
                sourceField: ["steam_id"],
                destSchema: members,
                destField: ["steam_id"],
            }),
            friends: r.many({
                sourceField: ["steam_id"],
                destSchema: friends_list,
                destField: ["steam_id"],
            }),
            friendOf: r.many({
                sourceField: ["steam_id"],
                destSchema: friends_list,
                destField: ["friend_steam_id"],
            }),
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
                destField: ["steam_id"],
            }),
        })),
        relationships(friends_list, (r) => ({
            steam: r.one({
                sourceField: ["steam_id"],
                destSchema: steam_accounts,
                destField: ["steam_id"],
            }),
            friend: r.one({
                sourceField: ["friend_steam_id"],
                destSchema: steam_accounts,
                destField: ["steam_id"],
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
                    (auth: Auth, q: ExpressionBuilder<Schema, 'steam_accounts'>) => q.exists("memberEntries", (u) => u.related("team",(t) => t.related("members", (m) => m.where("user_id", auth.sub)))),
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
    };
});