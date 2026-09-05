# apps/auth

The authentication service for Nestri, built on
[`@nestri/auth`](../../packages/auth/README.md) (OpenAuth-style issuer). One
handler, run either as a Cloudflare Worker or as an ordinary HTTP server.

## What it does

Hosts the OAuth issuer and the sign-in UI:

- **Email code** — the only provider, on purpose. Verifying an email address is the one thing that
  brings an account into existence, so an account is exactly as recoverable as its email. The
  `success` callback finds or creates the `User` row, ensures a personal team exists, and issues a
  JWT `user` subject containing `{ userID, linkedAccountID }`.
- **Device authorization grant** (RFC 8628) — for programs with no browser. A client starts a grant,
  a person approves it in a browser, and the client collects tokens by polling. Connecting a Steam
  account is not a sign-in and lives in `apps/api` instead, against a user who already exists.

## Key details

- **All issuer state is in Postgres.** There is no key-value binding. Signing keys, authorization
  codes, refresh tokens and device grants each have a table, because each is either a record whose
  loss ends every session (the keys) or one with a transition that must happen exactly once while
  two callers are touching it — a code is redeemed once, a refresh token is spent once, a grant is
  approved once. A store that reads and writes whole records cannot promise that. What is left in
  the generic `auth_kv` table is the rate-limit counters, which are allowed to be approximate.
- Authorization codes, refresh tokens and device codes are stored as hashes. Each is a bearer
  credential, so what is kept is enough to recognise one and not enough to present it.
- JWT subjects are defined in `@nestri/core/auth/subjects`.
- The API verifies tokens against this issuer through `AUTH_ISSUER_URL`, which must be this
  service's **public** URL: a token carries the address it was minted through and the check is
  literal.

## Structure

```text
src/index.ts      # The handler: issuer config, stores, success callback
src/server.ts     # The same handler behind a listening socket
src/email.ts      # Verification code delivery
wrangler.jsonc    # Worker configuration, one environment per stage
Dockerfile        # The container, built from the repository root
test/
```

## Running

```sh
bun run dev      # under the Workers runtime, on :1337
bun run serve    # as a plain process, on $PORT (default 1337)
```

Its only stateful dependency is Postgres — as a `HYPERDRIVE` binding on Workers, or as
`DATABASE_URL` anywhere else — alongside the mail settings. Full list and deployment steps:
[`docs/deploy.md`](../../docs/deploy.md).
