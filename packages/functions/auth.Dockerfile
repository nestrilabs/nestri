FROM mirror.gcr.io/oven/bun:1.2

ADD ./package.json .
ADD ./bun.lock .
ADD ./packages/core/package.json ./packages/core/package.json
ADD ./packages/functions/package.json ./packages/functions/package.json
ADD ./patches ./patches
RUN bun install --ignore-scripts

ADD ./packages/functions ./packages/functions
ADD ./packages/core ./packages/core

WORKDIR ./packages/functions
CMD ["bun", "run", "./src/auth.ts"]