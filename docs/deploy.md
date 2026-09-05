# Deploying the control plane

Two apps — [`apps/api`](../apps/api) and [`apps/auth`](../apps/auth) — and two
ways to run each of them. There is one handler per app and it is the same
handler both ways: a function from a request to a response, holding no opinion
about what is calling it.

| | |
| --- | --- |
| **Cloudflare Workers**, via `wrangler` | what production and sandbox are today |
| **A container**, via the `Dockerfile` in each app | what a self-hoster runs, and where this is going |

Settings arrive as bindings in the first case and as environment variables in
the second, and `@nestri/core`'s `Env` resolves the two into one shape — so
`HYPERDRIVE` and `DATABASE_URL` are two spellings of the database, and an
`AUTH` service binding and `AUTH_INTERNAL_URL` are two spellings of the route
to the issuer. Nothing in either app branches on which it got.

Hostnames, and why they are shaped the way they are: [`dns.md`](dns.md).

## Locally

Three ways, in increasing order of how much they resemble a deployment.

```sh
cp .env.example .env          # once; compose has no credentials of its own
docker compose up postgres    # the database, for either of the next two
bun dev                       # both apps under the Workers runtime
bun run dev:server            # both apps as plain processes
docker compose up --build     # both apps as containers, plus the database
```

`bun dev` runs two `wrangler dev` sessions, on ports 1337 and 3000. They find
each other through wrangler's local registry, so the API reaches the issuer
over the same service binding it uses in production rather than over the
network — which is the point of running it this way. Neither needs a
Cloudflare account: the Hyperdrive binding falls back to
`localConnectionString`, which is the compose database.

Settings that exist only locally live in `apps/auth/.dev.vars` rather than in
`vars`. `wrangler dev` reads that file and `wrangler deploy` cannot upload it,
which is the guarantee wanted for the one setting in it — the one that prints
sign-in codes to the log.

`docker compose` here is Docker's plugin or `podman-compose`; both read the
file unchanged.

Migrations are never run for you, in any of the three:

```sh
bun run db:migrate            # against DATABASE_URL
```

## Cloudflare Workers

Configuration is [`apps/auth/wrangler.jsonc`](../apps/auth/wrangler.jsonc) and
[`apps/api/wrangler.jsonc`](../apps/api/wrangler.jsonc). Each has two named
environments, `sandbox` and `production`, plus an unnamed default that is the
local one.

Wrangler's named environments do **not** inherit bindings from the top level —
`vars`, `services` and `hyperdrive` are repeated in each on purpose, and a
setting added to one environment and not the other is a silent hole rather than
an error.

### One-time setup

```sh
bunx wrangler login

# Once per database. Prints an id; paste it into both wrangler.jsonc files,
# replacing the placeholder for that environment.
bunx wrangler hyperdrive create nestri-production --connection-string "postgres://…"
bunx wrangler hyperdrive create nestri-sandbox    --connection-string "postgres://…"
```

Hyperdrive is a connection pool in front of Postgres, and it is there because
each Worker isolate would otherwise open a connection of its own — which
Postgres answers, at some point in a busy hour, with *"sorry, too many clients
already"*. A container has one pool per process and needs none of this.

### Secrets

Set per app and per environment, and held by Cloudflare rather than by this
repository:

```sh
cd apps/auth
bunx wrangler secret put EMAIL_SEND_URL --env production
bunx wrangler secret put EMAIL_API_KEY  --env production
bunx wrangler secret put EMAIL_FROM     --env production

cd ../api
bunx wrangler secret put ADMIN_SHARED_SECRET --env production
```

`ADMIN_SHARED_SECRET` turns any request carrying it into an operator, so
generate it rather than choosing it — `openssl rand -hex 32` — and never give
it a default anywhere. What it is for is listed in
[`apps/api/README.md`](../apps/api/README.md).

The issuer refuses to send a sign-in code with its mail settings half
configured or absent, rather than falling back to printing codes to the log —
so a deployment that forgets these fails at the first sign-in attempt with a
message naming what is missing, instead of quietly logging usable codes.

### Deploying

```sh
bun run deploy:sandbox
bun run deploy:production
```

Both deploy the issuer first and the API second, because the API's `AUTH`
binding names a script that has to exist. The custom domains in the config are
what create the DNS records — there is no separate step, and no separate tool
holding the other half of that fact.

## Containers

```sh
docker build -f apps/api/Dockerfile  -t nestri-api  .
docker build -f apps/auth/Dockerfile -t nestri-auth .
```

The context is the repository root in both cases: the lockfile and the two
shared packages are there, and a context rooted at the app directory could not
reach them. Both use the repository-wide `.dockerignore`; only the guest rootfs
build has one of its own, as `build/Dockerfile.dockerignore` — a
`<Dockerfile>.dockerignore` **replaces** the repository-wide file rather than
adding to it, which is worth knowing before writing a third.

Both images are stateless and hold no configuration. What they need:

| | `auth` | `api` |
| --- | --- | --- |
| `DATABASE_URL` | required | required |
| `AUTH_ISSUER_URL` | — | required, the issuer's **public** URL |
| `AUTH_INTERNAL_URL` | — | only if that URL is unroutable from here |
| `EMAIL_SEND_URL` `EMAIL_API_KEY` `EMAIL_FROM` | all three, or none | — |
| `EMAIL_DEV_LOG` | `true` prints codes instead of sending | — |
| `ADMIN_SHARED_SECRET` | — | required; operator access |
| `PORT` | default `1337` | default `3000` |

[`docker-compose.yml`](../docker-compose.yml) at the root wires all of it
together with a Postgres, and is the smallest complete answer to *"how do I run
this myself"*.

Neither image terminates TLS or serves a certificate, and neither marks the
cookies it sets `Secure`, because both expect to sit behind something that does
terminate TLS. So put a reverse proxy in front of them and keep the origin
unreachable except through it — `docker-compose.yml` publishes their ports on
loopback only for exactly this reason, and changing that to `0.0.0.0` is a way
to reach the issuer *around* the proxy with codes and tokens in clear text.
