FROM docker.io/node:24-alpine AS base

FROM base AS build
WORKDIR /usr/src/app
COPY package.json ./
COPY patches ./patches
COPY packages/input ./packages/input
COPY packages/play-standalone ./packages/play-standalone
RUN cd packages/play-standalone && npm install && npm run build

FROM base AS runner
WORKDIR /www
COPY --from=build /usr/src/app/packages/play-standalone/dist ./dist
COPY --from=build /usr/src/app/node_modules ./node_modules

RUN apk add --no-cache tini

EXPOSE 3000
WORKDIR /www
ENTRYPOINT ["/sbin/tini", "--", "node", "./dist/server/entry.mjs"]