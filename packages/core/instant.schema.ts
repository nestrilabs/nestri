import { i } from "@instantdb/core";

const _schema = i.schema({
  // This section lets you define entities: think `posts`, `comments`, etc
  // Take a look at the docs to learn more:
  // https://www.instantdb.com/docs/modeling-data#2-attributes
  entities: {
    $users: i.entity({
      email: i.string().unique().indexed(),
    }),
    // This is here because the $users entity has no more than 1 property; email
    profiles: i.entity({
      name: i.string(),
      location: i.string(),
      createdAt: i.number(),
      deletedAt: i.string().optional()
    }),
    machines: i.entity({
      name: i.string(),
      fingerprint: i.string().indexed(),
      location: i.string(),
      createdAt: i.number(),
      deletedAt: i.string().optional()
    }),
    teams: i.entity({
      name: i.string(),
      type: i.string(), // "Personal" or "Family"
      createdAt: i.number(),
      deletedAt: i.string().optional()
    })
  },
  links: {
    userProfiles: {
      forward: { on: 'profiles', has: 'one', label: 'owner' },
      reverse: { on: '$users', has: 'one', label: 'profile' },
    },
    machineOwners: {
      forward: { on: 'machines', has: 'one', label: 'owner' },
      reverse: { on: '$users', has: 'many', label: 'machinesOwned' },
    },
    machineTeams: {
      forward: { on: 'machines', has: 'one', label: 'team' },
      reverse: { on: 'teams', has: 'many', label: 'machines' },
    },
    userTeams: {
      forward: { on: 'teams', has: 'one', label: 'owner' },
      reverse: { on: '$users', has: 'many', label: 'teamsOwned' },
    },
    teamMembers: {
      forward: { on: 'teams', has: 'many', label: 'members' },
      reverse: { on: '$users', has: 'many', label: 'teams' },
    }
  }
});

// This helps Typescript display nicer intellisense
type _AppSchema = typeof _schema;
interface AppSchema extends _AppSchema { }
const schema: AppSchema = _schema;

export type { AppSchema };
export default schema;
