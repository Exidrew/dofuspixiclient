# Multi-stage build: server (gateway + core) + client static assets.
#
# NOTE: previously this Dockerfile copied `apps/server/`, a directory that no
# longer exists — the gameserver is now `apps/gameserver-ts` (gateway + core
# over Unix sockets). Use docker-compose.local.yml, which describes the full
# stack (postgres + redis + core game/auth + gateway); this Dockerfile only
# builds the JS bundles.
FROM oven/bun:1.3 AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock turbo.json ./
COPY apps/gameserver-ts/package.json apps/gameserver-ts/
COPY apps/electrobun/package.json apps/electrobun/
COPY packages/grid/package.json packages/grid/
COPY packages/protocol/package.json packages/protocol/
RUN bun install --frozen-lockfile

# Copy source
COPY apps/ apps/
COPY packages/ packages/

# Build
RUN bun run build

# ── Production server ──
FROM oven/bun:1.3-slim
WORKDIR /app

COPY --from=base /app/node_modules node_modules
COPY --from=base /app/apps/gameserver-ts apps/gameserver-ts
COPY --from=base /app/packages packages

# The server reads DATABASE_URL exclusively (see
# apps/gameserver-ts/src/core/shared/config/env.schema.ts); REDIS_URL is
# optional. Provide both at `docker run` time.
ENV DATABASE_URL=postgres://dofus:dofus@postgres:5432/dofus
ENV REDIS_URL=redis://redis:6379

EXPOSE 8080

# Runs one process only. The full gameserver needs the gateway plus both cores
# (MODE=game / MODE=auth); docker-compose.local.yml starts all three.
CMD ["sh", "-c", "cd apps/gameserver-ts && bun run src/gateway/main.ts"]
