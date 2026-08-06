# apps/api

The public HTTP API for Nestri — a [Hono](https://hono.dev) app deployed as a Cloudflare Worker.

## What it does

Exposes the JSON API consumed by frontends and other clients. Every route is a thin wrapper that
validates input, delegates to a domain function in [`@nestri/core`](../../packages/core/README.md),
and returns `{ data: ... }`. All business logic lives in the core package.

Routes:

| Prefix            | Purpose                                                       |
| ----------------- | ------------------------------------------------------------- |
| `/`               | Health check                                                  |
| `/user`           | Current user profile, fingerprints, linked accounts           |
| `/steam`          | Link / sync / unlink a Steam account                          |
| `/library`        | Owned games with playtime                                     |
| `/games`          | Game catalog                                                 |
| `/pairing-code`   | Device pairing codes                                          |
| `/machine`        | Host machines                                                 |
| `/access-token`   | Short-lived access tokens                                     |
| `/doc`            | Generated OpenAPI spec                                        |

## Structure

```text
app/
  index.ts           # Hono entrypoint: middleware, routes, error handler, /doc
  middleware/auth.ts # Bearer JWT + admin shared-secret auth → Actor
  routes/*.ts        # Thin route namespaces (UserApi, SteamApi, ...)
  utils/             # ErrorResponses, Result(), validator wrapping
test/                # Route tests (Vitest/Bun)
```

## Key details

- Auth: `Authorization: Bearer <JWT>` verified against `@nestri/auth`; or the `x-nestri-admin-token` header (see `ADMIN_SHARED_SECRET`).
- Errors: centralized `VisibleError` → typed JSON responses.
- The API worker receives its bindings (`AUTH`, `HYPERDRIVE`, `STEAM_API_KEY`, `ADMIN_SHARED_SECRET`) from Alchemy — see `alchemy.run.ts` at the repo root.

## Running

Run via the root Alchemy setup (`bun alchemy.run.ts --dev`). Needs a Postgres database and an auth worker; see the root README for full dev setup.