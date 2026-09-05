# The issuer as a container.
#
# Build from the repository root — the workspace lockfile and two shared
# packages live there, so a context rooted at this directory could not resolve
# them:
#
#   docker build -f apps/auth/Dockerfile -t nestri-auth .
#
# The repository-wide `.dockerignore` is what this build excludes. It used to
# exclude the whole TypeScript half, because the guest rootfs build was the
# only Dockerfile here — that part now lives in `build/Dockerfile.dockerignore`,
# beside the build it belongs to.
# The registry host is part of the name on purpose: podman refuses a
# short name that resolves to nothing, and a self-hoster is as likely to
# have podman as docker.
FROM docker.io/oven/bun:1.3.11-alpine AS deps

WORKDIR /app

# Manifests first, source second. Dependencies change far less often than code
# does, so this layer survives most rebuilds. Every workspace member's manifest
# has to be here even if this image does not import it: the lockfile describes
# the whole workspace, and resolving it against a partial one is not frozen.
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/auth/package.json apps/auth/
COPY packages/core/package.json packages/core/
COPY packages/auth/package.json packages/auth/

# No dev dependencies. Bun runs TypeScript without a build step, so nothing in
# them is reachable at runtime — they are the type definitions, the linter and
# the deployment CLI.
RUN bun install --frozen-lockfile --production


FROM docker.io/oven/bun:1.3.11-alpine AS runtime

WORKDIR /app

COPY --from=deps /app/node_modules node_modules
COPY tsconfig.json ./
COPY package.json bun.lock ./
COPY apps/auth apps/auth
COPY packages/core packages/core
COPY packages/auth packages/auth

# The image ships no configuration. Every setting arrives from the environment,
# which is what makes one image good for a self-hoster and for us:
#
#   DATABASE_URL      postgres://…            required
#   EMAIL_SEND_URL    where a code is posted  \
#   EMAIL_API_KEY     credential for it        > all three together, or none
#   EMAIL_FROM        the sender address      /
#   EMAIL_DEV_LOG     `true` prints codes to the log instead of sending them
#
# With none of the three set and no `EMAIL_DEV_LOG`, the issuer refuses to send
# rather than falling back — a deployment that forgot its mail settings is
# exactly the one with nothing marking it as a real one.
ENV NODE_ENV=production
ENV PORT=1337
EXPOSE 1337

# `bun` is a non-root user the base image already provides.
USER bun

# The discovery document is served from memory and reaches no database, which
# is the right shape for a liveness probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
	CMD wget -q -O /dev/null http://127.0.0.1:${PORT}/.well-known/oauth-authorization-server || exit 1

CMD ["bun", "run", "apps/auth/src/server.ts"]
