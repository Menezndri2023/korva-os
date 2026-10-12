# Build context must be the monorepo root (`docker build -f apps/api/Dockerfile .`) —
# the pnpm workspace needs every package's manifest to resolve `workspace:*` deps.
FROM node:26-slim AS base
# corepack ships separately from Node.js as of Node 25+ — install pnpm directly instead.
RUN npm install -g pnpm@11.22.0
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/validation/package.json packages/validation/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/config/package.json packages/config/package.json
# `--fetch-timeout` raised from pnpm's 60s default. A cold image build downloads every tarball
# with no store cache, and on a slow or contended connection the default aborts the whole
# install with `TimeoutError: The operation was aborted due to timeout` — which reads like a
# broken Dockerfile and is not one. Verified: the same install completes in node:26-slim once
# the timeout is raised, native install scripts (argon2, msgpackr-extract) included, using the
# shipped linux-x64 prebuilds with no compiler involved.
#
# 300s, not 120s: 120 was still not enough on the connection this was verified against
# (tarballs at 8-19 KiB/s). It is a PER-REQUEST timeout, not a budget for the whole install, so
# a high value costs nothing on a fast network — it only decides how long one stalled download
# is given before the install is abandoned.
RUN pnpm install --frozen-lockfile --filter @korva/api... --fetch-timeout 300000

FROM deps AS build
COPY packages/types packages/types
COPY packages/validation packages/validation
COPY packages/ui packages/ui
COPY packages/config packages/config
COPY apps/api apps/api
RUN pnpm --filter @korva/api build

# Separate production-only install (--prod): excludes devDependencies (jest, typescript,
# eslint, @nestjs/cli, ts-node, ...) from what actually ships in the runtime image. Uses the
# exact same lockfile/manifests as `deps`, so it can never resolve anything the frozen
# lockfile didn't already pin — just a narrower dependency graph.
FROM base AS prod-deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/validation/package.json packages/validation/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/config/package.json packages/config/package.json
RUN pnpm install --frozen-lockfile --prod --filter @korva/api... --fetch-timeout 300000

# packages/{types,validation} have no build step (main/types point at src/*.ts directly,
# see docs/architecture-decisions.md ADR-001) — the compiled dist/main.js still needs
# their TypeScript source and Node's native .ts execution at runtime, not just node_modules.
FROM base AS runtime
ENV NODE_ENV=production
# node:26-slim ships a built-in unprivileged "node" user (uid/gid 1000) — reused as-is rather
# than creating a new one. --chown on every copy so the app actually owns what it needs to
# read, nothing more; WORKDIR below scopes it to only its own app directory.
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages ./packages
COPY --from=prod-deps --chown=node:node /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/package.json

WORKDIR /app/apps/api
USER node
EXPOSE 4000

# Liveness only — /api/v1/health does a bare {status:'ok'} with no DB/Redis check, which is
# the correct signal for "is this process alive and serving HTTP" (see main.ts's
# setGlobalPrefix('api/v1')). Deliberately NOT /health/database or /health/redis: those are
# diagnostic endpoints, and wiring the container's own liveness to an external dependency's
# transient blip is a well-known Docker HEALTHCHECK anti-pattern (readiness, not liveness).
# Uses Node's built-in fetch instead of curl/wget to avoid adding any package to the image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4000/api/v1/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

# No init process baked in: this app spawns no subprocesses, so there is nothing to reap, and
# Node handles SIGTERM as PID 1 without hanging. Run this image with `docker run --init` (or
# your orchestrator's equivalent — Kubernetes/ECS provide this per-pod/per-task already) for
# proper PID-1 signal forwarding, rather than bundling tini/dumb-init into the image itself.
CMD ["node", "dist/main.js"]
