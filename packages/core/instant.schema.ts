import { i } from "@instantdb/core";

const _schema = i.schema({
  entities: {
    $users: i.entity({
      email: i.string().unique().indexed(),
    }),
    machines: i.entity({
      hostname: i.string(),
      fingerprint: i.string().unique().indexed(),
      deletedAt: i.date().optional().indexed(),
      createdAt: i.date()
    }),
    games: i.entity({
      name: i.string(),
      steamID: i.number().unique().indexed(),
    }),
    sessions: i.entity({
      name: i.string(),
      startedAt: i.date(),
      endedAt: i.date().optional().indexed(),
      public: i.boolean().indexed(),
    }),
  },
  links: {
    UserMachines: {
      forward: { on: "machines", has: "one", label: "owner" },
      reverse: { on: "$users", has: "many", label: "machines" }
    },
    UserGames: {
      forward: { on: "games", has: "many", label: "owners" },
      reverse: { on: "$users", has: "many", label: "games" }
    },
    MachineSessions: {
      forward: { on: "machines", has: "many", label: "sessions" },
      reverse: { on: "sessions", has: "one", label: "machine" }
    },
    GamesMachines: {
      forward: { on: "machines", has: "many", label: "games" },
      reverse: { on: "games", has: "many", label: "machines" }
    },
    GameSessions: {
      forward: { on: "games", has: "many", label: "sessions" },
      reverse: { on: "sessions", has: "one", label: "game" }
    },
    UserSessions: {
      forward: { on: "sessions", has: "one", label: "owner" },
      reverse: { on: "$users", has: "many", label: "sessions" }
    }
  }
});

// This helps Typescript display nicer intellisense
type _AppSchema = typeof _schema;
interface AppSchema extends _AppSchema { }
const schema: AppSchema = _schema;

export type { AppSchema };
export default schema;
