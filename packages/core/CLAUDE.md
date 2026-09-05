# `packages/core` — domain modules

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

Configure `ADMIN_SHARED_SECRET` in `.env`. It has no default anywhere — a known value here is an authentication bypass, so nothing falls back to one.

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
