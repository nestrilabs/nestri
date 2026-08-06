# @nestri/core — Domain Module Guide

## Structure

Every domain module lives in `packages/core/src/<parent>/` as either a top-level namespace or a nested sub-module:

```
src/<parent>/
  ├── <parent>.sql.ts        # (optional) Drizzle table for the parent entity
  ├── index.ts               # Parent namespace (e.g. User, Game, Team)
  ├── <child>.sql.ts         # Sub-module table (e.g. fingerprint.sql.ts)
  └── <child>.ts             # Sub-module namespace (e.g. export namespace Fingerprint)
```

### Sub-modules nested under parents

| File                    | Namespace       | Why                                   |
| ----------------------- | --------------- | ------------------------------------- |
| `user/linked-account.*` | `LinkedAccount` | A user's OAuth/gaming identities      |
| `user/fingerprint.*`    | `Fingerprint`   | SSH key fingerprints                  |
| `game/download.*`      | `GameDownload`  | Per-host game depot downloads         |
| `user/library.*`        | `Library`       | User's owned games with playtime      |
| `team/member.*`         | `Member`        | Team membership with role             |
| `game/depot.*`          | `Depot`         | Platform-specific game content depots |

Existing top-level modules: `user/`, `team/`, `game/`, `pairing-code/`, `steam/`, `auth/`, `db/`.

Modules that don't own their own table (like `steam/`) only need a single `index.ts` exposing reusable `fn()` functions — no `.sql.ts` file.

## Pattern: `.sql.ts` (Drizzle Table)

```ts
// src/<module>/<module>.sql.ts
import { pgTable, text, boolean, jsonb, uniqueIndex, index, pgEnum } from 'drizzle-orm/pg-core';

import { id, timestamps, ulid } from '../db/types.js';

// Enum (only if needed — co-located with its table)
export const SomeEnum = pgEnum('some_enum', ['a', 'b']);

// FK imports — use the sql.ts files, never the index.ts (avoids circular deps)
import { UserTable } from '../user/user.sql.js';

export const SomeTable = pgTable(
	'some_table',
	{
		...id, // char(30) PK, prefix: som_
		...timestamps, // time_created, time_updated, time_deleted (all utc)

		// FK column — always use ulid() + .references()
		userId: ulid('user_id')
			.notNull()
			.references(() => UserTable.id, { onDelete: 'cascade' }),

		// Scalar columns
		name: text('name').notNull(),
		email: text('email'), // nullable = omit .notNull()
		flag: boolean('flag').notNull().default(false),
		metadata: jsonb('metadata').$type<{}>(), // JSON blob

		// Enum column
		provider: SomeEnum('provider').notNull()
	},
	(t) => [
		uniqueIndex('some_table_provider_unique').on(t.provider, t.providerAccountId),
		index('some_table_sync_idx')
			.on(t.userId)
			.where(sql`${t.localValue} is distinct from ${t.remoteValue}`),
		index('some_table_user_idx').on(t.userId)
	]
);
```

### DB types (`src/db/types.ts`)

| Helper       | Output                                                          |
| ------------ | --------------------------------------------------------------- |
| `ulid(name)` | `char(30)` — for PKs and FKs                                    |
| `id`         | `{ id: ulid('id').primaryKey().notNull() }` — spread as `...id` |
| `utc(name)`  | `timestamp with time zone`                                      |
| `timestamps` | `{ timeCreated, timeUpdated (auto), timeDeleted }`              |

### Naming conventions

- Table name: `snake_case` (e.g. `linked_account`, `team_member`)
- Column name: `snake_case` (e.g. `user_id`, `provider_account_id`, `time_created`)
- TypeScript field names: `camelCase` matching the column (drizzle maps them)
- Index names: `{table}_{column(s)}_unique` / `{table}_{column}_idx`

---

## Pattern: `index.ts` (Domain Namespace)

```ts
// src/<module>/index.ts
import { eq, and, isNull, sql } from 'drizzle-orm';
import z from 'zod';

import { Database } from '../db/index.js';
import { Examples } from '../examples.js';
import { fn } from '../fn.js';
import { SomeTable, SomeEnum } from './<module>.sql.js';

export namespace SomeModule {
  // ── Info schema ─────────────────────────────────────────────────────
  // Single source of truth for the entity shape.
  // Every field typed here; .meta() adds OpenAPI metadata.
  // When a field changes here, TypeScript catches every usage.
  export const Info = z
    .object({
      id: z.string().meta({
        description: '…',
        example: Examples.SomeModule.id,
      }),
      // For enum fields, use z.enum(SomeEnum.enumValues) to stay in sync:
      provider: z.enum(SomeEnum.enumValues).meta({ … }),
      // Nullable + optional for JSON-blob / optional fields:
      metadata: z.record(z.string(), z.unknown()).nullable().optional().meta({ … }),
    })
    .meta({
      ref: 'SomeModule',
      description: '…',
      example: Examples.SomeModule,
    });

  export type Info = z.infer<typeof Info>;

  // ── create ───────────────────────────────────────────────────────────
  // Use Info.pick({…}) for the schema — keeps fields in sync with Info.
  // Input is the parsed object.
  // Use Database.use() for single-operation writes.
  export const create = fn(
    Info.pick({ id: true, name: true, email: true }),
    async (input) => {
      await Database.use(async (tx) => {
        await tx.insert(SomeTable).values({
          id: input.id,
          name: input.name,
          email: input.email ?? null,
        });
      });
      return input.id;
    }
  );

  // ── Single-field lookups ─────────────────────────────────────────────
  // Use Info.shape.<field> for the schema.
  // The callback receives the raw value, not { field: value }.
  export const fromID = fn(Info.shape.id, async (id) => {
    return Database.use(async (tx) => {
      return tx
        .select()
        .from(SomeTable)
        .where(and(eq(SomeTable.id, id), isNull(SomeTable.timeDeleted)))
        .then((rows) => rows.at(0) ?? null);
    });
  });

  export const fromSlug = fn(Info.shape.slug, async (slug) => {
    // …
  });

  // ── Multi-field lookups ──────────────────────────────────────────────
  // Use Info.pick({ field1: true, field2: true })
  export const findByProvider = fn(
    Info.pick({ provider: true, providerAccountId: true }),
    async (input) => {
      return Database.use(async (tx) => {
        return tx
          .select()
          .from(SomeTable)
          .where(and(
            eq(SomeTable.provider, input.provider),
            eq(SomeTable.providerAccountId, input.providerAccountId),
            isNull(SomeTable.timeDeleted),
          ))
          .then((rows) => rows.at(0) ?? null);
      });
    }
  );

  // ── List (no args) ───────────────────────────────────────────────────
  // Plain async function — no fn() wrapper since there's no input.
  export async function list() {
    return Database.use(async (tx) => {
      return tx
        .select()
        .from(SomeTable)
        .where(isNull(SomeTable.timeDeleted))
        .orderBy(SomeTable.timeCreated);
    });
  }

  // ── List by FK ───────────────────────────────────────────────────────
  export const listByUser = fn(Info.shape.userId, async (userId) => {
    return Database.use(async (tx) => {
      return tx
        .select()
        .from(SomeTable)
        .where(and(eq(SomeTable.userId, userId), isNull(SomeTable.timeDeleted)))
        .orderBy(SomeTable.timeCreated);
    });
  });

  // ── Update ───────────────────────────────────────────────────────────
  // If the update uses Info fields + possibly extra fields:
  export const updateSomething = fn(
    Info.pick({ id: true, otherField: true }).extend({
      extraField: z.string(),
    }),
    async (input) => {
      await Database.use(async (tx) => {
        await tx
          .update(SomeTable)
          .set({ otherField: input.otherField })
          .where(eq(SomeTable.id, input.id));
      });
    }
  );

  // ── Soft-delete ──────────────────────────────────────────────────────
  // Use sql\`now()\` for the timestamp (consistent with DB time).
  export const remove = fn(Info.shape.id, async (id) => {
    await Database.use(async (tx) => {
      await tx
        .update(SomeTable)
        .set({ timeDeleted: sql`now()` })
        .where(eq(SomeTable.id, id));
    });
  });

  // ── serialize ────────────────────────────────────────────────────────
  // Converts a DB row into the public API shape. Keeps serialization
  // decoupled from the DB layer.
  export function serialize(input: typeof SomeTable.$inferSelect): z.infer<typeof Info> {
    return {
      id: input.id,
      name: input.name,
      // Cast enums since drizzle returns a string at runtime:
      provider: input.provider as Info['provider'],
    };
  }

  // ── listByUserWithGames ──────────────────────────────────────────────
  // JOIN query with serialization inside the fn() boundary.
  // The .then() chain maps raw rows to the public shape immediately.
  export const listByUserWithGames = fn(Info.shape.userId, async (userId) => {
    return Database.use(async (tx) => {
      return tx
        .select({
          library: UserLibraryTable,
          game: GameTable
        })
        .from(UserLibraryTable)
        .leftJoin(GameTable, eq(UserLibraryTable.gameId, GameTable.id))
        .where(and(eq(UserLibraryTable.userId, userId), isNull(UserLibraryTable.timeDeleted)))
        .orderBy(UserLibraryTable.timeCreated)
        .then((rows) =>
          rows
            .filter((row) => row.game !== null)
            .map((row) => ({
              id: row.library.id,
              game: Game.serialize(row.game!),
              playtime2w: row.library.playtime2w,
              playtimeForever: row.library.playtimeForever,
              lastPlayed: row.library.lastPlayed?.toISOString() ?? null
            }))
        );
    });
  });
}
```

### Key rules for `fn()` usage

| Case                 | Schema                                     | Callback receives                     |
| -------------------- | ------------------------------------------ | ------------------------------------- |
| Single field         | `Info.shape.field`                         | Raw value (`string`, `boolean`, etc.) |
| Multiple fields      | `Info.pick({a:true, b:true})`              | `{ a, b }` object                     |
| Full entity          | `Info`                                     | Full `Info` object                    |
| Info fields + extras | `Info.pick({…}).extend({extra: z.type()})` | `{ …fields, extra }`                  |
| No input             | Regular `async function`                   | n/a                                   |

### What `fn()` does

```ts
fn(schema, callback);
// → (input) => { schema.parse(input); return callback(parsed); }
// The returned function also has a .schema property for OpenAPI introspection.
```

---

## Serialization Boundary Rule

**All data transformation — including JOIN deserialization, field mapping, date stringification, and null filtering — happens INSIDE the `fn()` boundary, right after the DB query in a `.then()` chain. The API route is a dumb pass-through.**

### Why this matters

| Approach                                              | Queries      | Boundary clarity                       |
| ----------------------------------------------------- | ------------ | -------------------------------------- |
| **Bad**: Raw rows from core, map/filter in route      | N+1 (or raw) | Leaky — route knows DB schema          |
| **Bad**: JOIN in core, but serialize in route         | 1            | Still leaky — route owns shaping logic |
| **Good**: JOIN + serialize in `.then()` inside `fn()` | 1            | Clean — core returns JSON-safe objects |

### The pattern

```ts
// GOOD: serialization inside fn()
export const listByUserWithGames = fn(Info.shape.userId, async (userId) => {
  return Database.use(async (tx) => {
    return tx
      .select({ library: UserLibraryTable, game: GameTable })
      .from(UserLibraryTable)
      .leftJoin(GameTable, eq(UserLibraryTable.gameId, GameTable.id))
      .where(...)
      .orderBy(...)
      .then((rows) =>
        rows
          .filter((row) => row.game !== null)
          .map((row) => ({
            id: row.library.id,
            game: Game.serialize(row.game!),
            lastPlayed: row.library.lastPlayed?.toISOString() ?? null
          }))
      );
  });
});

// GOOD: API route is a thin pass-through
async (c) => {
  const data = await Library.listByUserWithGames(Actor.userID);
  return c.json({ data });
}
```

### Rules

1. **Never let raw Drizzle `$inferSelect` rows escape the core module.** If a function returns joined data, it must be shaped before the return.
2. **Use `.then()` after the query for map/filter/serialize.** Keeps the async pipeline declarative and co-located with the SQL.
3. **Re-use sibling `serialize()` functions for joined tables.** e.g. `Game.serialize(row.game!)` when joining `GameTable`.
4. **API routes only do:** auth checks, input validation, calling the core fn, and `c.json({ data })`. No `.map()`, no `.filter()`, no field remapping.

---

### Mutation Rule: Single-Query Reads via `.returning()`

Never execute a separate `tx.select()` or trigger a lookup function immediately after an `insert` or `upsert` mutation to fetch the updated state of a row.

Postgres natively supports the `RETURNING` clause. Always append `.returning()` directly to your mutation chains and destructure the resulting array (`const [row] = await tx...`). This ensures mutations remain atomic, avoids unnecessary connection pool overhead, and removes the latency penalty of running two sequential database operations.

---

## Pattern: ID generation (`src/id.ts`)

```ts
Identifier.ascending('user')          // → "usr_<monotonic-id>"
Identifier.ascending('team')          // → "tem_<monotonic-id>"
Identifier.ascending('linkedAccount') // → "lac_<monotonic-id>"

// Prefixes are defined in Identifier.prefixes:
{
  user: 'usr',
  linkedAccount: 'lac',
  team: 'tem',
  teamMember: 'mem',
  verification: 'ver',
}
```

The IDs are 30-char strings: `{prefix}_{26 base62 chars}`. They are monotonically increasing (time-sortable) when using `ascending()`.

---

## Pattern: Examples (`src/examples.ts`)

```ts
export namespace Examples {
  export const Id = (prefix: keyof typeof Identifier.prefixes) =>
    `${Identifier.prefixes[prefix]}_XXXXXXXXXXXXXXXXXXXXXXXXX`;

  export const User = { id: Id('user'), name: '…', email: '…', … };
  export const LinkedAccount = { id: Id('linkedAccount'), provider: 'steam', … };
  export const Team = { id: Id('team'), slug: 'my-team', … };
  export const Member = { id: Id('teamMember'), role: 'owner' as const, … };
  export const Fingerprint = { id: Id('userFingerprint'), fingerprint: '…', … };
  export const GameDownload = { id: Id('gameDownload'), hostId: 'hst_…', gameId: Id('game'), status: 'downloading', … };
  export const Library = { id: Id('userLibrary'), playtimeForever: 150000, … };
  export const Depot = { id: Id('gameDepot'), depotId: 730, … };
}
```

Every entity in `Examples` must be added and imported by the `Info` schema's `.meta({ example: … })`.

---

## Pattern: Environment (`src/env.ts`)

```ts
export namespace Env {
	export const Info = z.object({
		NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
		FRONTEND_URL: z.string().optional(),
		STEAM_API_KEY: z.string().optional(),
		AUTH_ISSUER_URL: z.string().optional() // used by API auth middleware to verify tokens
	});
	export type Info = z.infer<typeof Info>;
	export const env: Info = Info.parse(process.env);
}
```

---

## Pattern: OpenAuth Subjects (`src/auth/subjects.ts`)

```ts
import { createSubjects } from '@nestri/auth/subject';
import { z } from 'zod';

export const subjects = createSubjects({
	user: z.object({
		userID: z.string(),
		linkedAccountID: z.string()
	})
});
```

The JWT contains `{ type: 'user', properties: { userID, linkedAccountID } }`.
The API verifies via `client.verify(subjects, token)` from `@nestri/auth/client`.

---

## Entity relationships

```
User ───1:N─── LinkedAccount    ← auth methods (Steam, Epic, etc.)
  │
  ├─── 1:N ─── Fingerprint     ← SSH public keys
  ├─── 1:N ─── Library         ← owned games with playtime
  │
  └─── N:M ─── Team            ← via Member
                                     └─ role: owner | admin | member

Game ───1:N─── Download        ← per-host game depot downloads
```

- **User**: Person record. Email is nullable (gaming accounts don't provide one).
- **LinkedAccount**: A gaming/OAuth identity. `(provider, providerAccountId)` is unique.
- **Team**: Organization for billing/collaboration. First team is auto-created as "personal" team.
- **TeamMember**: Joins User → Team with a role. `(teamId, userId)` is unique.

---

## Database access

```ts
// Auto-scoped transaction (creates one if outside a transaction):
await Database.use(async (tx) => {
  await tx.insert(SomeTable).values({ … });
  const result = await tx.select().from(SomeTable).where(…);
});

// Explicit transaction:
await Database.transaction(async (tx) => {
  // All operations in one atomic transaction
});

// Side-effect queued after transaction commits:
Database.effect(() => sendEmail(…));
```

---

## Soft-delete convention

Every table has `time_deleted` (nullable timestamp). Queries filter with `isNull(table.timeDeleted)`. Deletion sets `timeDeleted: sql\`now()\`` — never hard-deletes.

---

## Dependency rule

- `.sql.ts` files may import from other `.sql.ts` files (for FK references).
- `index.ts` files may import from other `index.ts` files and `.sql.ts` files.
- Never import an `index.ts` from within a `.sql.ts` — that creates circular deps.

---

## Actor Model (`packages/core/src/actor.ts`)

The Actor model identifies who/what is making a request. It uses `AsyncLocalStorage` (via `Context.create()`) so the actor is accessible anywhere in the call chain without passing it around.

### Actor types

```ts
type ActorInfo =
	| { type: 'public'; properties: {} }
	| { type: 'user'; properties: { userID: string; linkedAccountID: string } }
	| {
			type: 'member';
			properties: { userID: string; teamID: string; role: 'owner' | 'admin' | 'member' };
	  }
	| { type: 'system'; properties: { teamID: string } }
	| { type: 'admin'; properties: {} };
```

### API

```ts
Actor.use(); // → ActorInfo (throws if no context set)
Actor.with(value, fn); // Run fn in the given actor context
Actor.assert(type); // Assert current actor type, returns narrowed type
Actor.type; // → 'public' | 'user' | 'member' | 'system' | 'admin'
Actor.userID; // → string (user/member only)
Actor.linkedAccountID; // → string (user only)
Actor.useTeam; // → string (member/system only — the teamID)
Actor.role; // → 'owner' | 'admin' | 'member' (member only)
Actor.isSignedIn; // → boolean (true if not public)
```

### When to pull from Actor vs pass as param

Functions that create resources owned by the current user (e.g. `Team.create`) pull `userID` from the actor context rather than requiring it as a parameter. This avoids passing `ownerId`/`userId` through the entire call chain.

Domain functions that need the actor's identity import `Actor` and call `Actor.userID` inside the `fn()` callback:

```ts
export const create = fn(Info.pick({ id: true, name: true, slug: true }), async (input) => {
	const ownerId = Actor.userID; // from AsyncLocalStorage
	// ...
});
```

### Actor.userID inside Database.transaction()

When doing find-or-create logic that must scope to the authenticated user, pull `Actor.userID` **inside** the `Database.transaction()` callback. This keeps scoping co-located with the DB logic:

```ts
export const link = fn(
  z.object({ steamId: z.string(), profile: z.record(z.string(), z.unknown()).optional() }),
  async (input) => {
    return Database.transaction(async () => {
      const existing = await LinkedAccount.findByProvider({ ... });
      if (existing) return existing.id;
      const id = Identifier.ascending('linkedAccount');
      await LinkedAccount.create({ id, userId: Actor.userID, provider: 'steam', ... });
      return id;
    });
  }
);
```

This ensures the API endpoint is scoped to the user only — no `userId` param is passed from the route handler. The `Actor.userID` is set by the auth middleware's `Actor.with()`, propagated via `AsyncLocalStorage`.

Callers must wrap actor-dependent work in `Actor.with()` before calling these functions. The API middleware does this automatically for HTTP requests. The auth worker sets it up explicitly:

```ts
await Actor.with({ type: 'user', properties: { userID, linkedAccountID } }, async () => {
	await Team.createPersonal({ displayName: personaname });
});
```

---

## Auth Flow

### Auth Worker (`apps/auth/src/index.ts`)

A Cloudflare Worker using `@nestri/auth` (OpenAuth). Entry point is the `success` callback after OAuth:

1. Steam returns `steamid` → worker fetches profile from Steam API
2. Inside `Database.transaction()`: looks up existing `LinkedAccount.findByProvider`; if found returns existing user, else creates `User` + `LinkedAccount`
3. Wraps post-login setup in `Actor.with()`, then checks `Member.listByUser(userID)`
4. If no memberships, calls `Team.createPersonal({ displayName })`
5. Issues JWT via `context.subject('user', { userID, linkedAccountID })`

### Admin Auth via Shared Secret

Server-to-server calls can authenticate as an `admin` actor by setting the `x-nestri-admin-token` header to the value of `ADMIN_SHARED_SECRET`. This bypasses JWT auth entirely and grants a system-level actor with no user scope — useful for operations like adding games to the DB, syncing data, or other admin tasks.

Configure `ADMIN_SHARED_SECRET` in `.env`; defaults to the same value as `SSH_AUTH_KEY` in dev (`dev-ssh-auth-key-change-in-prod`).

### Auth Middleware (`apps/api/app/middleware/auth.ts`)

Hono middleware that runs on every API request:

1. Checks `x-nestri-admin-token` header — if it matches `Env.get().ADMIN_SHARED_SECRET`, sets actor to `admin` and proceeds immediately
2. Otherwise, reads `Authorization: Bearer <token>` header
3. Verifies via `client.verify(subjects, token)` from `@nestri/auth/client`
4. If valid `user` subject:
   - Checks `x-nestri-team` header for team-scoped access
   - If team header present, verifies membership via `Member.findByTeamAndUser`
   - Sets actor to `member` (with role) or `user` type
5. If no token/invalid: sets actor to `public` type
6. Exports `notPublic` guard middleware — throws `VisibleError('authentication', UNAUTHORIZED, …)` if actor is `public`. Caught by `onError` → 401 JSON response. The `admin` actor passes this guard (it's not `public`), so admin routes can use `.use(notPublic)` like any other protected route.

### OpenAuth Subjects (`src/auth/subjects.ts`)

```ts
export const subjects = createSubjects({
	user: z.object({ userID: z.string(), linkedAccountID: z.string() })
});
```

The JWT contains `{ type: 'user', properties: { userID, linkedAccountID } }`.
Env var `AUTH_ISSUER_URL` configures which issuer to trust for token verification.

---

## Team Discriminator System

When creating a personal team (`Team.createPersonal`), the slug is derived from the display name:

```ts
// 1. Sanitize: lowercase, replace non-alphanumeric with dashes, trim edges, max 50 chars
const baseSlug = displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-')...

// 2. Check if slug exists (fromSlug)
// 3. If taken, append random 4-digit discriminator: "name-1234"
const slug = existing ? `${baseSlug}-${discriminator}` : baseSlug;
```

This mirrors Discord's discriminator pattern. The discriminator is part of the slug string — not a separate column.

---

## `fn()` and Actor Context

`fn()` itself is unchanged — it validates input against a zod schema and calls the callback. The actor context is available inside `fn()` callbacks because `Actor.with()` uses `AsyncLocalStorage`, which propagates automatically through `await` chains.

Every `fn()` callback can import and use `Actor` directly. No special wiring needed.

---

## API Error Pattern (`packages/core/src/error.ts`)

Centralized error types used by both the domain layer and the API.

### ErrorResponse

Zod schema for OpenAPI error responses:

```ts
import { z } from 'zod';

export const ErrorResponse = z
	.object({
		type: z.enum([
			'validation',
			'authentication',
			'forbidden',
			'not_found',
			'already_exists',
			'rate_limit',
			'internal'
		]),
		code: z.string(),
		message: z.string(),
		param: z.string().optional(),
		details: z.any().optional()
	})
	.meta({ ref: 'ErrorResponse' });
```

### ErrorCodes

Structured error code constants:

| Category         | Codes                                                                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `Validation`     | `MISSING_REQUIRED_FIELD`, `ALREADY_EXISTS`, `TEAM_ALREADY_EXISTS`, `INVALID_PARAMETER`, `INVALID_FORMAT`, `INVALID_STATE`, `IN_USE` |
| `Authentication` | `UNAUTHORIZED`, `INVALID_TOKEN`, `EXPIRED_TOKEN`, `INVALID_CREDENTIALS`                                                             |
| `Permission`     | `FORBIDDEN`, `INSUFFICIENT_PERMISSIONS`, `ACCOUNT_RESTRICTED`                                                                       |
| `NotFound`       | `RESOURCE_NOT_FOUND`                                                                                                                |
| `RateLimit`      | `TOO_MANY_REQUESTS`, `QUOTA_EXCEEDED`                                                                                               |
| `Server`         | `INTERNAL_ERROR`, `SERVICE_UNAVAILABLE`, `DEPENDENCY_FAILURE`                                                                       |

### VisibleError

Throw this for any user-facing error. It carries structured data and converts cleanly to HTTP:

```ts
throw new VisibleError(
	'not_found',
	ErrorCodes.NotFound.RESOURCE_NOT_FOUND,
	`User ${id} does not exist`
);
```

- `.statusCode()` — maps `type` → HTTP status (validation→400, authentication→401, forbidden→403, not_found→404, already_exists→409, rate_limit→429, internal→500)
- `.toResponse()` → `{ type, code, message, param?, details? }`

The API's global `onError` handler catches `VisibleError` + `HTTPException` + unknown errors, logging each and returning the correct JSON shape.

---

## API Route Pattern (`apps/api/app/routes/`)

Every API domain is a TypeScript `namespace` with a `.route` property — a plain `new Hono()` instance with chained route definitions.

### Route → Domain function flow

```
HTTP request ──► Route handler (thin) ──► Core domain fn() ──► DB
                     │                        │
                     │ validates input         │ pulls Actor.userID
                     │ calls domain fn         │ handles business logic
                     │ returns c.json({data})  │ inside Database.transaction()
```

Route handlers are **thin wrappers** — they validate input, call a core function, and return the result. All business logic lives in `packages/core/src/<module>/`.

### Creating a route module

```ts
// app/routes/<thing>.ts
import { z } from 'zod';
import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';
import { Thing } from '@nestri/core/thing/index';
import { Examples } from '@nestri/core/examples';
import { ErrorCodes, VisibleError } from '@nestri/core/error';
import { ErrorResponses, notPublic, Result, validator } from '../utils';

export namespace ThingApi {
	export const route = new Hono()
		.use(notPublic)
		.get(
			'/',
			describeRoute({
				tags: ['Thing'],
				summary: 'List things',
				description: 'List all things',
				responses: {
					200: {
						content: {
							'application/json': {
								schema: Result(
									Thing.Info.array().meta({
										description: 'All things',
										example: [Examples.Thing]
									})
								)
							}
						},
						description: 'All things'
					},
					400: ErrorResponses[400],
					404: ErrorResponses[404],
					429: ErrorResponses[429]
				}
			}),
			async (c) => c.json({ data: await Thing.list() })
		)
		.get(
			'/:id',
			describeRoute({/* … */}),
			validator(
				'param',
				z.object({
					id: z.string().meta({
						description: 'ID of the thing',
						example: Examples.Thing.id
					})
				})
			),
			async (c) => {
				const thing = await Thing.fromID(c.req.valid('param').id);
				if (!thing) {
					throw new VisibleError(
						'not_found',
						ErrorCodes.NotFound.RESOURCE_NOT_FOUND,
						`Thing ${id} not found`
					);
				}
				return c.json({ data: thing });
			}
		);
}
```

### Grouped routes: `/(group)/(sub-route)`

For domains with multiple sub-routes (e.g. Steam with `/link`, `/sync`, `/unlink`), group them under one route file. The namespace name is `XxxApi` (e.g. `SteamApi`), the route path is `/(group)`:

```ts
// app/routes/steam.ts
import { z } from "zod";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { Steam } from "@nestri/core/steam/index";
import { ErrorResponses, notPublic, Result, validator } from "../utils";

export namespace SteamApi {
  export const route = new Hono()
    .use(notPublic)
    .post("/link",       // → POST /steam/link
      describeRoute({ tags: ["Steam"], summary: "Link a Steam account", ... }),
      validator("json", z.object({ steamId: z.string() })),
      async (c) => {
        const { steamId } = c.req.valid("json");
        const result = await Steam.link({ steamId });  // ← calls core fn
        return c.json({ data: { linkedAccountId: result, steamId } });
      },
    )
    .post("/sync",       // → POST /steam/sync
      // ...
    );
}
```

Registered in the app entry as `/steam`:

```ts
// app/index.ts
import { SteamApi } from "./routes/steam.js";

const routes = app
  .route("/", IndexApi.route)
  .route("/users", UserApi.route)
  .route("/steam", SteamApi.route)   // mounts all /steam/* routes
  .onError(…);
```

This keeps the route path and the namespace name aligned — the Hono instance at `SteamApi.route` is mounted at `/steam`.

### Key conventions

| Element          | Pattern                                                                           |
| ---------------- | --------------------------------------------------------------------------------- |
| Structure        | `export namespace XxxApi { export const route = new Hono() … }`                   |
| Group route      | `POST "/link"` at `XxxApi` → mounted at `/xxx` → `POST /xxx/link`                 |
| Auth guard       | `.use(notPublic)` at the namespace level (or per-route)                           |
| Route is thin    | validates input → calls core fn → returns `c.json({ data: … })`                   |
| Core fn          | reusable `fn()` in `packages/core/src/<module>/` owns all logic                   |
| OpenAPI          | `describeRoute({ tags, summary, description, responses })` wraps each handler     |
| Response schema  | `Result(Schema)` → `resolver(z.object({ data: schema }))`                         |
| Error responses  | `ErrorResponses[statusCode]` for 400, 401, 403, 404, 409, 429, 500                |
| Param validation | `validator("param", z.object({…}))` — uses custom wrapper that formats Zod errors |
| Body validation  | `validator("json", z.object({…}))` — same wrapper for request body                |
| Not found        | `throw new VisibleError("not_found", ErrorCodes.NotFound.RESOURCE_NOT_FOUND, …)`  |
| Metadata         | Use `.meta()` (NOT `.openapi()`) — Zod v4 native + `zod-openapi` v6               |

### Registering a route in the app

```ts
// app/index.ts
import { SteamApi } from "./routes/steam.js";
import { ThingApi } from "./routes/thing.js";

const routes = app
  .route("/", IndexApi.route)
  .route("/users", UserApi.route)
  .route("/steam", SteamApi.route)   // mount group at /steam
  .route("/things", ThingApi.route)  // mount group at /things
  .onError(…);
```

The first argument to `.route()` is the URL prefix. All sub-routes defined on that Hono instance are relative to this prefix.

---

## API Utils (`apps/api/app/utils/`)

| File           | Export               | Purpose                                                                                        |
| -------------- | -------------------- | ---------------------------------------------------------------------------------------------- |
| `index.ts`     | —                    | Barrel re-export of all utils                                                                  |
| `auth.ts`      | `auth`, `notPublic`  | Re-exports from `middleware/auth`                                                              |
| `error.ts`     | `ErrorResponses`     | `{ 400, 401, 403, 404, 409, 429, 500 }` → OpenAPI response objects                             |
| `result.ts`    | `Result<T>`          | `resolver(z.object({ data: T }))` — standard `{ data: … }` response shape                      |
| `validator.ts` | `validator`          | Wraps `hono-openapi/zod`'s validator with standardized Zod error formatting (400 + error code) |
| `hook.ts`      | `Hook`, `zValidator` | Type declarations (re-exported from `@hono/zod-validator`)                                     |

---

## Main API Entry (`apps/api/app/index.ts`)

The entry point wires everything together. Key structure:

```ts
import 'zod-openapi'; // augment Zod v4 with OpenAPI metadata types
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { cors } from 'hono/cors';
import { showRoutes } from 'hono/dev';
import { openAPISpecs } from 'hono-openapi';
import { HTTPException } from 'hono/http-exception';

export const app = new Hono();

// Global middleware (order matters)
app
	.use(logger())
	.use(async (c, next) => {
		c.header('Cache-Control', 'no-store');
		return next();
	})
	.use(cors({ origin: Env.env.FRONTEND_URL || 'http://localhost:5173', credentials: true }))
	.use(auth);

// Routes + error handler
const routes = app
	.route('/', IndexApi.route)
	.route('/things', ThingApi.route)
	.onError((error, c) => {
		if (error instanceof VisibleError) {
			return c.json(error.toResponse(), error.statusCode());
		}
		if (error instanceof HTTPException) {
			return c.json(
				{
					type: 'validation',
					code: ErrorCodes.Validation.INVALID_PARAMETER,
					message: 'Invalid request'
				},
				error.status
			);
		}
		return c.json(
			{
				type: 'internal',
				code: ErrorCodes.Server.INTERNAL_ERROR,
				message: 'Internal server error'
			},
			500
		);
	});

// OpenAPI spec at /doc
app.get(
	'/doc',
	openAPISpecs(routes, { documentation: { info: { title: 'API', version: '0.0.1' } } })
);

showRoutes(app);

export default { port: process.env.PORT ?? 3000, fetch: app.fetch };
```

### Dev / production

```
bun --watch app/index.ts   # dev with hot reload
bun app/index.ts            # production
```

No Vite needed — Bun runs TypeScript natively.

---

## Important: `.meta()` vs `.openapi()`

| Library                    | Method       | Notes                                                                                |
| -------------------------- | ------------ | ------------------------------------------------------------------------------------ |
| `zod-openapi` v4 (old)     | `.openapi()` | Required `import "zod-openapi/extend"`                                               |
| `zod-openapi` v6 (current) | `.meta()`    | Native Zod v4 method; no import needed — auto-augments via `declare module 'zod/v4'` |

- **Domain schemas** (`@nestri/core/*/index.ts`) use `.meta()` for descriptions/examples.
- **API route schemas** (`apps/api/app/routes/*.ts`) use `.meta()` for OpenAPI response/docs metadata.
- **Never** use `.openapi()` — it doesn't exist in `zod-openapi` v6.

---

## Error flow summary

```
Route handler
  │
  ├─ throws VisibleError ──► onError → c.json(error.toResponse(), error.statusCode())
  │
  ├─ throws HTTPException ─► onError → c.json({ type: "validation", … }, error.status)
  │
  ├─ throws raw Error ─────► onError → c.json({ type: "internal", … }, 500)
  │                         (includes VisibleError for Actor model / context issues)
  │
  └─ returns normally ─────► c.json({ data: … })
```

---

# Alchemy (IaC)

This project uses [Alchemy](https://alchemy.run) (v0.93.12) for infrastructure-as-code — the equivalent of SST, but targeting Cloudflare Workers instead of AWS Lambda.

## Project structure

```
web/
  alchemy.run.ts          # Entry point — creates scope, imports infra
  infra/
    stage.ts              # Stage detection (Scope.getCurrentScope().stage)
    secret.ts             # Encrypted secrets via alchemy.secret()
    auth.ts               # Auth Worker resource
    api.ts                # API Worker resource
```

## `alchemy.run.ts` — entry point

```ts
import alchemy from 'alchemy';

const app = await alchemy('nestri', {
	password: process.env.ALCHEMY_PASSWORD // required for secrets
});

// Import infra modules in dependency order (SST-style)
await import('./infra/stage.ts');
await import('./infra/secret.ts');
await import('./infra/auth.ts');
await import('./infra/api.ts');

await app.finalize();
```

Key rules:

- `alchemy(appName, opts)` creates a **scope** — resources register into this scope automatically
- `app.finalize()` must be called at the end to persist state
- Import order matters — resources that depend on others must be imported after
- `--dev` flag runs locally via Miniflare; omit it to deploy to Cloudflare

## Infra resources

Each resource is imported from `alchemy/cloudflare` and called with an ID + props:

```ts
import { Worker, KVNamespace, D1Database } from 'alchemy/cloudflare';

export const kv = await KVNamespace('my-kv');
export const db = await D1Database('my-db');

export const worker = await Worker('my-worker', {
	entrypoint: 'apps/some-app/src/index.ts',
	compatibility: 'node', // enables nodejs_compat flag
	url: true, // assign workers.dev URL
	bindings: {
		KV: kv, // resource binding → KVNamespace at runtime
		DB: db, // → D1Database
		PLAIN_VAR: 'hello' // → plain_text binding
	}
});
```

### Supported resources (subset)

| Resource      | Import               | Purpose                                         |
| ------------- | -------------------- | ----------------------------------------------- |
| `Worker`      | `alchemy/cloudflare` | Cloudflare Worker (entrypoint or inline script) |
| `KVNamespace` | `alchemy/cloudflare` | KV storage                                      |
| `D1Database`  | `alchemy/cloudflare` | D1 SQL database                                 |
| `R2Bucket`    | `alchemy/cloudflare` | R2 object storage                               |
| `Queue`       | `alchemy/cloudflare` | Queue/pub-sub                                   |

### Compatibility flag

Always add `compatibility: 'node'` to Workers that use Node.js built-ins (`node:async_hooks`, `crypto`, `node:stream`, etc.):

```ts
Worker('api', {
	entrypoint: 'apps/api/app/index.ts',
	compatibility: 'node' // enables nodejs_compat
});
```

## Stage detection

```ts
// infra/stage.ts
import { Scope } from 'alchemy';
const scope = Scope.getCurrentScope();
export const stage = scope?.stage ?? 'dev';
export const isPermanent = ['production', 'dev'].includes(stage);
```

Use stage for conditional infrastructure:

```ts
const api = await Worker('api', {
	...(isPermanent && {
		observability: { enabled: true },
		logpush: true
	})
});
```

Pass `--stage` flag at runtime: `bun alchemy.run.ts --stage production`

## Secrets and environment variables

Three levels of env management, from most-secure to least:

### 1. `alchemy.secret.env.X` (preferred)

```ts
// infra/secret.ts
import alchemy from 'alchemy';

export const secret = {
	steamApiKey: alchemy.secret.env.STEAM_API_KEY // reads process.env at deploy time
	// Equivalent to:
	// steamApiKey: alchemy.secret(process.env.STEAM_API_KEY),
};
```

- Reads from `process.env` at deploy time
- Throws a descriptive error if the env var is missing
- Encrypted in Alchemy state files (`.alchemy/`)
- Deployed as `secret_text` binding (hidden from Cloudflare API)

### 2. `alchemy.env()` (non-secret config)

```ts
export const frontendUrl = alchemy.env('FRONTEND_URL', 'http://localhost:5173');
```

- Optional default value
- Plain text — not encrypted
- Deployed as `plain_text` binding

### 3. Plain strings in `bindings` (inline)

```ts
bindings: {
	MY_VAR: 'hello';
}
```

- Hard-coded, visible in state files
- Deployed as `plain_text` binding

### How bindings map to runtime types

| Alchemy binding type | Deployed as    | Runtime type               |
| -------------------- | -------------- | -------------------------- |
| `Worker`             | `service`      | `Service` (has `.fetch()`) |
| `KVNamespace`        | `kv_namespace` | `KVNamespace`              |
| `D1Database`         | `d1`           | `D1Database`               |
| `alchemy.secret()`   | `secret_text`  | `string`                   |
| plain `string`       | `plain_text`   | `string`                   |
| `Json(...)`          | `json`         | `typeof json`              |

## Service bindings (Worker → Worker)

Pass one Worker as a binding to another:

```ts
// infra/auth.ts
export const auth = await Worker('auth', {
  entrypoint: 'apps/auth/src/index.ts',
  compatibility: 'node',
  bindings: { ... },
});

// infra/api.ts
import { auth } from './auth.ts';
export const api = await Worker('api', {
  entrypoint: 'apps/api/app/index.ts',
  bindings: { AUTH: auth },
});
```

At runtime, `env.AUTH` is a `Service` — call it directly:

```ts
const response = await env.AUTH.fetch(request);
```

### OpenAuth client + service binding

The `@openauthjs/openauth/client` only accepts a URL string for `issuer`, so use a custom `fetch` to route through the service binding:

```ts
function getClient(env: Record<string, unknown>) {
	return createClient({
		issuer: 'https://auth.internal', // dummy — used for path construction
		clientID: 'api',
		fetch: (input, init) => {
			const url = new URL(typeof input === 'string' ? input : input.url);
			const request = new Request(url.pathname + url.search, init);
			return (env.AUTH as { fetch: typeof fetch }).fetch(request);
		}
	});
}
```

## Env propagation to Workers

CF Workers receive env vars as the second argument to the `fetch` handler (`env`), NOT via `process.env`. Bridge the gap with a lazy + overridable schema:

```ts
// packages/core/src/env.ts
import { memo } from '../utils/memo.ts';

let _overrides: Record<string, unknown> = {};

export namespace Env {
	export const Info = z.object({
		FRONTEND_URL: z.string().optional(),
		STEAM_API_KEY: z.string().optional(),
		AUTH_ISSUER_URL: z.string().optional()
	});
	export type Info = z.infer<typeof Info>;

	const _get = memo(() => Info.parse({ ...process.env, ..._overrides }));

	export function get(): Info {
		return _get();
	}

	export function init(bindings: Record<string, unknown>) {
		_overrides = bindings;
		_get.reset();
	}
}
```

Wire in the Hono entrypoint:

```ts
export default {
	fetch(request, env, ctx) {
		Env.init(env); // merge CF bindings into Env
		return app.fetch(request, env, ctx);
	}
};
```

Now any module that imports `Env.get()` gets the correct values — on Bun dev `process.env` provides them, on CF Workers the bindings override.

## CLI usage

```sh
# Local dev (Miniflare)
bun alchemy.run.ts --dev

# Deploy to Cloudflare
bun alchemy.run.ts --stage production

# Destroy all resources
bun alchemy.run.ts --destroy

# With custom stage
bun alchemy.run.ts --stage wanjohiryan

# Password (for encrypting secrets)
export ALCHEMY_PASSWORD="some-passphrase"
```

When deploying, set `CLOUDFLARE_API_TOKEN` or configure `alchemy login`.

## Common patterns

### Conditional infra per-stage

```ts
Worker('api', {
	...(isPermanent && { logpush: true }),
	...(stage === 'production' && { scaling: { min: 3, max: 10 } })
});
```

### Across-app resource references

Alchemy uses top-level await in infra files — resources resolve at import time within the active scope. The scope propagates via `AsyncLocalStorage`, so any `await import()` after `alchemy(appName)` picks it up.

### .alchemy/ directory

Created automatically — contains Miniflare state, build output, and encrypted state files. Add to `.gitignore`.

```gitignore
.alchemy/
```

---

### Index Rule: Null-Safe Exclusions (`IS DISTINCT FROM`)

When writing indices to track data drift, synchronization deltas, or pending background worker states where values might be nullable, **always build a partial index utilizing Postgres-native `IS DISTINCT FROM`**.

Standard inequality operators (`!=` or `<>`) evaluate to `NULL` if either column is `NULL`, causing them to bypass standard `WHERE` index filters. Using `is distinct from` allows Postgres to treat `NULL` as a real value for state comparison:

- Excludes perfectly synchronized records completely from the index footprint.
- Optimizes heavy background worker poll queries directly into small, lightning-fast index scans.

2. Add to the Pattern: index.ts (Domain Namespace) section

Replace the existing create block and add the upsert block inside SomeModule:

```ts
// ── create ───────────────────────────────────────────────────────────
// Use Info.pick({…}) for the schema — keeps fields in sync with Info.
// Always use .returning() to get the updated row context in one database trip.
export const create = fn(Info.pick({ id: true, name: true, email: true }), async (input) => {
	return Database.use(async (tx) => {
		const [row] = await tx
			.insert(SomeTable)
			.values({
				id: input.id,
				name: input.name,
				email: input.email ?? null
			})
			.returning();
		return row;
	});
});

// ── upsert ───────────────────────────────────────────────────────────
// Simple copies use the input values directly. For coalesce-style set
// expressions, reference the excluded pseudo-table with unqualified
// identifiers: sql`excluded.${sql.identifier(SomeTable.name.name)}` —
// interpolating a column object (or its .name string) is invalid.
export const upsert = fn(Info.pick({ id: true, name: true }), async (input) => {
	return Database.use(async (tx) => {
		const [row] = await tx
			.insert(SomeTable)
			.values({ id: input.id, name: input.name })
			.onConflictDoUpdate({
				target: SomeTable.id,
				set: { name: input.name }
			})
			.returning();
		return row;
	});
});
```
