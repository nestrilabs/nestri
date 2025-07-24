FROM docker.io/oven/bun:1-alpine AS base
WORKDIR /usr/src/app

FROM base AS install
RUN mkdir -p /tmp/dev
COPY package.json bun.lock /tmp/dev/
COPY patches/*.patch /tmp/dev/patches/
RUN cd /tmp/dev && bun install --frozen-lockfile
RUN mkdir -p /tmp/prod
COPY package.json bun.lock /tmp/prod/
COPY patches/*.patch /tmp/prod/patches/
RUN cd /tmp/prod && bun install --production --frozen-lockfile

FROM base AS prerelease
COPY --from=install /tmp/dev/node_modules node_modules
COPY ./packages/play-standalone .

ENV NODE_ENV=production
RUN bun run build

FROM base AS release
COPY --from=install /tmp/prod/node_modules node_modules
COPY --from=prerelease /usr/src/app/index.ts .
COPY --from=prerelease /usr/src/app/package.json .

USER bun
EXPOSE 3000/tcp
ENTRYPOINT [ "bun", "run", "index.ts" ]