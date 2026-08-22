# Build context must be the monorepo root (`docker build -f apps/storefront/Dockerfile .`).
# See apps/web/Dockerfile for why this deliberately avoids `output: "standalone"`.
FROM node:26-slim AS base
RUN npm install -g pnpm@11.22.0
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/storefront/package.json apps/storefront/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/validation/package.json packages/validation/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/config/package.json packages/config/package.json
RUN pnpm install --frozen-lockfile --filter @korva/storefront...

FROM deps AS build
COPY packages/types packages/types
COPY packages/validation packages/validation
COPY packages/ui packages/ui
COPY packages/config packages/config
COPY apps/storefront apps/storefront
ARG NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm --filter @korva/storefront build

# Separate production-only install (--prod): excludes devDependencies (eslint, tailwindcss,
# @types/*, typescript, ...) from what actually ships in the runtime image. Same
# lockfile/manifests as `deps`, just a narrower dependency graph.
FROM base AS prod-deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/storefront/package.json apps/storefront/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/validation/package.json packages/validation/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/config/package.json packages/config/package.json
RUN pnpm install --frozen-lockfile --prod --filter @korva/storefront...

FROM base AS runtime
ENV NODE_ENV=production
# node:26-slim ships a built-in unprivileged "node" user (uid/gid 1000) — reused as-is rather
# than creating a new one. --chown on every copy so the app actually owns what it needs to
# read, nothing more.
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/apps/storefront ./apps/storefront
# Overwrite the per-package node_modules the previous line just copied (dev+prod, from the
# `build` stage) with the prod-only one — same final path, narrower dependency set.
COPY --from=prod-deps --chown=node:node /app/apps/storefront/node_modules ./apps/storefront/node_modules

WORKDIR /app/apps/storefront
USER node
EXPOSE 3000

# No dedicated health route exists in this app, and one isn't worth adding just for Docker —
# `/` is a static, unauthenticated, dependency-free page (see app/page.tsx), so a plain HTTP
# GET on it is a valid, least-invasive liveness signal. Uses Node's built-in fetch instead of
# curl/wget to avoid adding any package to the image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

# No init process baked in: `next start` spawns no subprocesses of its own in this
# configuration, so there is nothing to reap. Run this image with `docker run --init` (or your
# orchestrator's equivalent) for proper PID-1 signal forwarding, rather than bundling
# tini/dumb-init into the image itself.
CMD ["node_modules/.bin/next", "start"]
