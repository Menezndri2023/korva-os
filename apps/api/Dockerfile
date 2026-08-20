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
RUN pnpm install --frozen-lockfile --filter @korva/api...

FROM deps AS build
COPY packages/types packages/types
COPY packages/validation packages/validation
COPY packages/ui packages/ui
COPY packages/config packages/config
COPY apps/api apps/api
RUN pnpm --filter @korva/api build

# packages/{types,validation} have no build step (main/types point at src/*.ts directly,
# see docs/architecture-decisions.md ADR-001) — the compiled dist/main.js still needs
# their TypeScript source and Node's native .ts execution at runtime, not just node_modules.
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json

WORKDIR /app/apps/api
EXPOSE 4000
CMD ["node", "dist/main.js"]
