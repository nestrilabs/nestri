import {
    table,
    string,
    number,
    createSchema,
    relationships,
    definePermissions,
} from "@rocicorp/zero";

// TODO: Add the user's here as well :)

const timestamps = {
    time_created: number(),
    time_updated: number(),
    time_deleted: number().optional(),
} as const;

const team = table("team")
    .columns({
        id: string(),
        name: string(),
        slug: string(),
        plan_type: string<"Hosted" | "BYOG">(),
        ...timestamps,
    })
    .primaryKey("id");

const member = table("member")
    .columns({
        id: string(),
        email: string(),
        team_id: string(),
        time_created: number(),
        time_updated: number(),
        time_seen: number().optional(),
        time_deleted: number().optional(),
    })
    .primaryKey("team_id", "id");

export const schema = createSchema(1, {
    tables: [team, member],
    relationships: [
        relationships(member, (r) => ({
            team: r.one({
                sourceField: ["team_id"],
                destSchema: team,
                destField: ["id"],
            }),
            members: r.many({
                sourceField: ["team_id"],
                destSchema: member,
                destField: ["team_id"],
            }),
        })),
        relationships(team, (r) => ({
            members: r.many({
                sourceField: ["id"],
                destSchema: member,
                destField: ["team_id"],
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
        member: {
            row: {
                select: [
                    (auth, q) => q.exists("members", (u) => u.where("email", auth.sub)),
                ],
            },
        },
        team: {
            row: {
                select: [
                    (auth, q) => q.exists("members", (u) => u.where("email", auth.sub)),
                ],
            },
        },
    };
});