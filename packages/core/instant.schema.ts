import { i } from "@instantdb/core";

const _schema = i.schema({
  entities: {
    $users: i.entity({
      email: i.string().unique().indexed(),
    }),
    // machines: i.entity({
    //   hostname: i.string(),
    //   fingerprint: i.string().unique().indexed(),
    //   deletedAt: i.date().optional().indexed(),
    //   createdAt: i.date()
    // }),
    tasks: i.entity({
      type: i.string(),
      lastStatus: i.string(),
      healthStatus: i.string(),
      startedAt: i.string(),
      lastUpdated: i.date(),
      stoppedAt: i.string().optional(),
      taskID: i.string().unique().indexed()
    }),
    instances: i.entity({
      hostname: i.string(),
      lastActive: i.date().optional(),
      createdAt: i.date()
    }),
    profiles: i.entity({
      avatarUrl: i.string().optional(),
      username: i.string().indexed(),
      status: i.string().indexed(),
      updatedAt: i.date().indexed(),
      createdAt: i.date(),
      discriminator: i.string().indexed()
    }),
    teams: i.entity({
      name: i.string(),
      slug: i.string().unique().indexed(),
      deletedAt: i.date().optional(),//.indexed(),
      updatedAt: i.date(),
      createdAt: i.date(),
    }),
    // games: i.entity({
    //   name: i.string(),
    //   steamID: i.number().unique().indexed(),
    // }),
    sessions: i.entity({
      startedAt: i.date(),
      endedAt: i.date().optional().indexed(),
      public: i.boolean().indexed(),
    }),
    subscriptions: i.entity({
      checkoutID: i.string(),
      canceledAt: i.date(),
    })
  },
  links: {
    UserSubscriptions: {
      forward: { on: "subscriptions", has: "one", label: "owner" },
      reverse: { on: "$users", has: "many", label: "subscriptions" }
    },
    UserProfiles: {
      forward: { on: "profiles", has: "one", label: "owner" },
      reverse: { on: "$users", has: "one", label: "profile" }
    },
    UserTasks: {
      forward: { on: "tasks", has: "one", label: "owner" },
      reverse: { on: "$users", has: "many", label: "tasks" }
    },
    TaskSessions: {
      forward: { on: "tasks", has: "many", label: "sessions" },
      reverse: { on: "sessions", has: "one", label: "task" }
    },
    UserSession: {
      forward: { on: "sessions", has: "one", label: "owner" },
      reverse: { on: "$users", has: "many", label: "sessions" }
    },
    TeamsOwned: {
      forward: { on: "teams", has: "one", label: "owner" },
      reverse: { on: "$users", has: "many", label: "teamsOwned" },
    },
    TeamsJoined: {
      forward: { on: "teams", has: "many", label: "members" },
      reverse: { on: "$users", has: "many", label: "teamsJoined" },
    },
    // UserMachines: {
    //   forward: { on: "machines", has: "one", label: "owner" },
    //   reverse: { on: "$users", has: "many", label: "machines" }
    // },
    // UserGames: {
    //   forward: { on: "games", has: "many", label: "owners" },
    //   reverse: { on: "$users", has: "many", label: "games" }
    // },
    // TeamInstances: {
    //   forward: { on: "instances", has: "many", label: "owners" },
    //   reverse: { on: "teams", has: "many", label: "instances" }
    // },
    // MachineSessions: {
    //   forward: { on: "machines", has: "many", label: "sessions" },
    //   reverse: { on: "sessions", has: "one", label: "machine" }
    // },
    // GamesMachines: {
    //   forward: { on: "machines", has: "many", label: "games" },
    //   reverse: { on: "games", has: "many", label: "machines" }
    // },
    // GameSessions: {
    //   forward: { on: "games", has: "many", label: "sessions" },
    //   reverse: { on: "sessions", has: "one", label: "game" }
    // },
    // UserSessions: {
    //   forward: { on: "sessions", has: "one", label: "owner" },
    //   reverse: { on: "$users", has: "many", label: "sessions" }
    // }
  }
});

// This helps Typescript display nicer intellisense
type _AppSchema = typeof _schema;
interface AppSchema extends _AppSchema { }
const schema: AppSchema = _schema;

export type { AppSchema };
export default schema;
