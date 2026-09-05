# apps/api

The public HTTP API for Nestri — a [Hono](https://hono.dev) app. One handler, run either as a
Cloudflare Worker or as an ordinary HTTP server.

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
  index.ts           # The handler: middleware, routes, error handler, /doc
  server.ts          # The same handler behind a listening socket
  middleware/auth.ts # Bearer JWT + admin shared-secret auth → Actor
  routes/*.ts        # Thin route namespaces (UserApi, SteamApi, ...)
  utils/             # ErrorResponses, Result(), validator wrapping
wrangler.jsonc       # Worker configuration, one environment per stage
Dockerfile           # The container, built from the repository root
test/                # Route tests
```

## Key details

- Auth: `Authorization: Bearer <JWT>` verified against `@nestri/auth`; or the `x-nestri-admin-token` header (see `ADMIN_SHARED_SECRET`).
- Errors: centralized `VisibleError` → typed JSON responses.
- Settings arrive as bindings or as environment variables, and two of them have one spelling of
  each: Postgres is `HYPERDRIVE` or `DATABASE_URL`, and the route to the issuer is an `AUTH`
  service binding or `AUTH_INTERNAL_URL`. Nothing here branches on which it got.
- `AUTH_ISSUER_URL` is the issuer's **public** URL and never the internal one, because it is
  compared literally against the `iss` claim on every token.

## Running

```sh
bun run dev      # under the Workers runtime, on :3000
bun run serve    # as a plain process, on $PORT (default 3000)
```

Needs a Postgres database and a reachable issuer. Full list and deployment steps:
[`docs/deploy.md`](../../docs/deploy.md).