# apps/auth

The authentication worker for Nestri — a Cloudflare Worker built on
[`@nestri/auth`](../../packages/auth/README.md) (OpenAuth-style issuer).

## What it does

Hosts the OpenID Connect / OAuth issuer and the login UI:

- **Steam OAuth** — the primary login flow. After Steam redirects back, the worker fetches the
  player's profile, creates (or finds) the `User` + `LinkedAccount` rows in Postgres, auto-creates a
  personal team on first login, and issues a JWT `user` subject containing `{ userID, linkedAccountID }`.
- **SSH login** — authenticates a device via its SSH fingerprint (keyed by `SSH_AUTH_KEY`),
  resolving the identity through `Steam.resolveSshIdentity` in `@nestri/core`.

## Key details

- Signing keys are generated at runtime and persisted in the `AuthStorage` KV namespace.
- JWT subjects are defined in `@nestri/core/auth/subjects`.
- The API worker calls this worker via a service binding (`AUTH`), verified through `AUTH_ISSUER_URL`.

## Structure

```text
src/index.ts      # Worker entrypoint: issuer config + success callbacks (steam, ssh)
test/             # Worker tests
```

## Running

Deployed through Alchemy (`apps/auth` worker in `alchemy.run.ts` at the repo root) with bindings
`AuthStorage` (KV), `HYPERDRIVE` (Postgres), `STEAM_API_KEY`, `SSH_AUTH_KEY`.
