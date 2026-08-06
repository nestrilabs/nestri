# packages/auth (`@nestri/auth`)

Framework-agnostic OpenAuth implementation for Nestri — the OAuth/OIDC **issuer**, **client**,
**subjects**, and the login **UI**. A vendored/forked build of **OpenAuth**.

## What it does

Everything needed to run your own authentication provider:

- **`issuer.ts`** — the authorization server: routes for `/authorize`, `/callback`, `/token`,
  `/userinfo`, `.well-known/*`, plus the login UI (React renderer).
- **`client.ts`** — `createClient` to verify JWTs against the issuer ("who is this token?").
- **`subject.ts`** — typed JWT subjects (`zod` schemas for the token payload).
- **`provider/*`** — drop-in OAuth/OIDC providers (steam, discord, github, google, apple,
  microsoft, slack, spotify, twitch, x, yahoo, facebook, linkedin, cognito, keycloak, jumpcloud,
  oauth2, oidc, password, ssh, code, arctic).
- **`storage/*`** — persistence adapters for keys/sessions/codes: `memory`, `cloudflare` (KV),
  `aws`, `dynamo`.
- **`ui/*`** — the login page components (forms, password, code, theme, CSS).
- **`jwt.ts`, `keys.ts`, `pkce.ts`, `random.ts`** — signing, keypair management, PKCE, randomness.

## Usage

Consumed by the [`apps/auth`](../../apps/auth/README.md) worker, e.g.:

```ts
import { issuer } from '@nestri/auth/index';
import { CloudflareStorage } from '@nestri/auth/storage/cloudflare';
import { SteamProvider } from '@nestri/auth/provider/steam';
```

The API uses `createClient` (from `@openauth/openauth/client`) or the bundled `client.ts` to verify
tokens against the issuer URL.

## Scripts

```sh
bun test      # run tests
bun run build # build (see script/build.ts)
```

## Note

`@openauthjs` is the upstream project; this package's exports are meant to be API-compatible with a
pinned preference toward tree-shaking-friendly imports. Prefer importing subpaths over the barrel
(`@nestri/auth/index`).