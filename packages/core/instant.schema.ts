import { i } from "@instantdb/core";

const _schema = i.schema({
  // This section lets you define entities: think `posts`, `comments`, etc
  // Take a look at the docs to learn more:
  // https://www.instantdb.com/docs/modeling-data#2-attributes
  entities: {
    $users: i.entity({
      email: i.string().unique().indexed(),
    }),
    profiles: i.entity({
      name: i.string(),
      userId: i.string().unique(),
      fingerprint: i.string(),
      createdAt: i.number(),
      deletedAt: i.string().optional()
    })
  },
  links: {
    userProfiles: {
      forward: { on: 'profiles', has: 'one', label: 'owner' },
      reverse: { on: '$users', has: 'one', label: 'profile' },
    },
  }
});

// This helps Typescript display nicer intellisense
type _AppSchema = typeof _schema;
interface AppSchema extends _AppSchema { }
const schema: AppSchema = _schema;

export type { AppSchema };
export default schema;
