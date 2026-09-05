# The API as a container.
#
# Build from the repository root — the workspace lockfile and two shared
# packages live there, so a context rooted at this directory could not resolve
# them:
#
#   docker build -f apps/api/Dockerfile -t nestri-api .
#
# The repository-wide `.dockerignore` is what this build excludes. It used to
# exclude the whole TypeScript half, because the guest rootfs build was the
# only Dockerfile here — that part now lives in `build/Dockerfile.dockerignore`,
# beside the build it belongs to.
FROM oven/bun:1.3.11-alpine AS deps

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


FROM oven/bun:1.3.11-alpine AS runtime

WORKDIR /app

COPY --from=deps /app/node_modules node_modules
COPY tsconfig.json ./
COPY package.json bun.lock ./
COPY apps/api apps/api
COPY packages/core packages/core
COPY packages/auth packages/auth

# The image ships no configuration. Every setting arrives from the environment,
# which is what makes one image good for a self-hoster and for us:
#
#   DATABASE_URL          postgres://…               required
#   AUTH_ISSUER_URL       the issuer's public URL    required
#   STEAM_API_KEY         for linking an account
#   ADMIN_SHARED_SECRET   operator access
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# `bun` is a non-root user the base image already provides.
USER bun

# `/` answers without touching the database, which is the right shape for a
# liveness probe: it says this process is serving, and leaves "can it reach
# Postgres" to a readiness check that is allowed to fail loudly.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
	CMD wget -q -O /dev/null http://127.0.0.1:${PORT}/ || exit 1

CMD ["bun", "run", "apps/api/app/server.ts"]
