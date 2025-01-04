import { i } from "@instantdb/core";

const _schema = i.schema({
  // Take a look at the docs to learn more:
  // https://www.instantdb.com/docs/modeling-data#2-attributes
  entities: {
    $users: i.entity({
      email: i.string().unique().indexed(),
    }),
    locations: i.entity({
      country: i.string().unique().indexed(),
      continent: i.string(),
      timeZone: i.string(),
    }),
    machines: i.entity({
      hostname: i.string(),
      createdAt: i.date(),
      fingerprint: i.string().unique().indexed(),
      deletedAt: i.date().optional().indexed()
    }),
    genres: i.entity({
      name: i.string().indexed()
    }),
    operatingSystems: i.entity({
      name: i.string()
    }),
    esrbAgeRatings: i.entity({
      name: i.string().unique(),
      description: i.string()
    }),
    ageRatingDescriptors: i.entity({
      name: i.string().indexed().unique(),
      description: i.string()
    }),
    games: i.entity({
      name: i.string(),
      url: i.string(),
      steamID: i.number().unique().indexed(),
      description: i.json(),
      protonCompatibility: i.number(),
      controllerSupport: i.string(),
      size: i.string(),
      images: i.json(),
    }),
    sessions: i.entity({
      url: i.string().unique(),
      createdAt: i.string(),
      public: i.boolean().indexed(),
      resolution: i.string(),
      framerate: i.string(),
      endedAt: i.string()
    }),
    status: i.entity({
      name: i.string().unique(),
      description: i.string()
    })
  },
  links: {
    MachineLocations: {
      forward: { on: "machines", has: "one", label: "location" },
      reverse: { on: "locations", has: "many", label: "machines" }
    },
    UserMachines: {
      forward: { on: "$users", has: "many", label: "machines" },
      reverse: { on: "machines", has: "one", label: "owner" }
    },
    GameEsrbRatings: {
      forward: { on: "games", has: "many", label: "esrbRatings" },
      reverse: { on: "esrbAgeRatings", has: "many", label: "games" },
    },
    GameAgeRatingDescriptors: {
      forward: { on: "games", has: "many", label: "ageRatingDescriptors" },
      reverse: { on: "ageRatingDescriptors", has: "many", label: "games" },
    },
    GameOperatingSystems: {
      forward: { on: "games", has: "many", label: "operatingSystems" },
      reverse: { on: "operatingSystems", has: "many", label: "games" }
    },
    GameGenres: {
      forward: { on: "games", has: "many", label: "genres" },
      reverse: { on: "genres", has: "many", label: "games" }
    },
    MachineGames: {
      forward: { on: "machines", has: "many", label: "games" },
      reverse: { on: "games", has: "many", label: "machines" }
    },
    UserGames: {
      forward: { on: "$users", has: "many", label: "games" },
      reverse: { on: "games", has: "many", label: "owners" }
    },
    GameSessions: {
      forward: { on: "games", has: "many", label: "sessions" },
      reverse: { on: "sessions", has: "one", label: "game" }
    },
    SessionStatus: {
      forward: { on: "sessions", has: "one", label: "status" },
      reverse: { on: "status", has: "many", label: "sessions" }
    },
  //   MachineStatus: {
  //     forward: { on: "machines", has: "one", label: "status" },
  //     reverse: { on: "status", has: "many", label: "machines" }
  //   },
  //  UserStatus: {
  //     forward: { on: "$users", has: "one", label: "status" },
  //     reverse: { on: "status", has: "many", label: "users" }
  //   },
    MachineSessions: {
      forward: { on: "machines", has: "many", label: "sessions" },
      reverse: { on: "sessions", has: "one", label: "machine" }
    },
    UserSessions: {
      forward: { on: "$users", has: "one", label: "session" },
      reverse: { on: "sessions", has: "one", label: "owner" }
    }
  }
});

// This helps Typescript display nicer intellisense
type _AppSchema = typeof _schema;
interface AppSchema extends _AppSchema { }
const schema: AppSchema = _schema;

export type { AppSchema };
export default schema;
