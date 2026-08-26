# `apps/api` — routes, errors and the entry point

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

