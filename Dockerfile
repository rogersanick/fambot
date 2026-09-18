# Fambot API + worker image for Fly.io. The Fly [processes] section picks the
# command per machine: api or worker.
FROM oven/bun:1 AS base
WORKDIR /app

# Install with the full workspace manifest for correct linking
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/bridge/package.json apps/bridge/
COPY apps/desktop/package.json apps/desktop/
COPY packages/shared/package.json packages/shared/
COPY packages/database/package.json packages/database/
COPY packages/domain/package.json packages/domain/
COPY packages/ai/package.json packages/ai/
COPY packages/messaging/package.json packages/messaging/
COPY packages/calendar/package.json packages/calendar/
COPY packages/mcp/package.json packages/mcp/
RUN bun install --frozen-lockfile --production

COPY packages packages
COPY apps/api apps/api
COPY apps/worker apps/worker

ENV NODE_ENV=production
EXPOSE 8787

# Default: API. Fly worker process overrides with `bun apps/worker/src/index.ts`.
CMD ["bun", "apps/api/src/index.ts"]
