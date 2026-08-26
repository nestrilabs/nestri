# Alchemy — infrastructure as code

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
