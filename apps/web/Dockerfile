# Build context must be the monorepo root (`docker build -f apps/web/Dockerfile .`).
#
# Deliberately does NOT use Next.js `output: "standalone"`: its file tracer has a known
# gap with pnpm's symlinked `@swc/helpers` (the runtime crashes with MODULE_NOT_FOUND on
# `@swc/helpers/esm/_interop_require_default.js`, verified while building this image) —
# copying the full node_modules and running `next start` avoids that trap entirely, at
# the cost of a larger image.
FROM node:26-slim AS base
RUN npm install -g pnpm@11.22.0
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/validation/package.json packages/validation/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/config/package.json packages/config/package.json
RUN pnpm install --frozen-lockfile --filter @korva/web...

FROM deps AS build
COPY packages/types packages/types
COPY packages/validation packages/validation
COPY packages/ui packages/ui
COPY packages/config packages/config
COPY apps/web apps/web
ARG NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm --filter @korva/web build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/web ./apps/web

WORKDIR /app/apps/web
EXPOSE 3000
CMD ["node_modules/.bin/next", "start"]
