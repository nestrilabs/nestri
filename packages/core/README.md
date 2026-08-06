# packages/core

`@nestri/core` — the **domain layer** for Nestri. All business logic, database access, and
serialization lives here. The API and auth workers are thin pass-through translation layers on top.

## What it contains

| Area | Files | Purpose |
| ---- | ----- | ------- |
| **db** | `db/index.ts`, `db/types.ts`, `db/test.ts` | Drizzle + Postgres (`Database.use/transaction`), ULID column helpers |
| **users** | `user/*` | Users, linked accounts, fingerprints, library |
| **teams** | `team/*` | Teams + membership with roles (`team_member`) |
| **games** | `game/*` | Game catalog, depot content, per-host downloads |
| **steam** | `steam/index.ts` | Steam API integration & SSH identity resolution |
| **auth** | `auth/subjects.ts` | JWT subjects shared with the auth worker |
| **infra** | `env.ts`, `context.ts`, `actor.ts`, `fn.ts`, `id.ts`, `error.ts`, `examples.ts` | Environment, Actor model, zod-typed `fn()` wrappers, IDs, error types, examples |
| **migrations** | `migrations/` | Drizzle-kit SQL migrations for Postgres schema |

## Conventions

- **Domain namespaces** (`user/`, `team/`, ...) expose typed `fn()` functions that validate input
  with a Zod schema and serialize DB rows inside the function boundary — the API routes never see raw table rows.
- **Actor model**: `Actor.userID`, `Actor.type`, ... pull the current authenticated identity from
  `AsyncLocalStorage` (set by the API middleware / auth worker) without passing it through call chains.
- **Soft delete**: every table has `time_deleted`; queries filter with `isNull(table.timeDeleted)`.
- **IDs**: ULIDs via `Identifier.ascending('user')` → `usr_...`.
- Tables are defined in `*.sql.ts` files (drizzle) with namespaces in `index.ts`.
- Environment is read through `Env.get()`, init by worker bindings.

## Structure

```text
src/
├── actor.ts, env.ts, id.ts, fn.ts, error.ts, examples.ts
├── db/
├── auth/
├── user/       (user.sql.ts, linked-account.*, fingerprint.*, library.*, index.ts)
├── team/       (team.sql.ts, member.*, index.ts)
├── game/       (game.sql.ts, depot.*, download.*, index.ts)
├── steam/      (index.ts)
├── pairing-code/
├── access-token/
└── machine/
```

## Scripts

```sh
bun run db:push   # push schema (drizzle-kit)
bun run db        # open drizzle-kit
```

## Usage

```ts
import { Team } from '@nestri/core/team/index';
import { Database } from '@nestri/core/db/index';

const team = await Team.fromID('tem_...');
```