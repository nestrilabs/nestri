# apps/auth

The authentication worker for Nestri — a Cloudflare Worker built on
[`@nestri/auth`](../../packages/auth/README.md) (OpenAuth-style issuer).

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
- The API worker verifies tokens against this issuer through `AUTH_ISSUER_URL`.

## Structure

```text
src/index.ts      # Worker entrypoint: issuer config, stores, success callback
src/email.ts      # Verification code delivery
test/             # Worker tests
```

## Running

Deployed through Alchemy (`apps/auth` worker in `alchemy.run.ts` at the repo root). Its only
stateful binding is `HYPERDRIVE` (Postgres), alongside the mail settings.
