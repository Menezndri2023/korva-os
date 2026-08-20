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

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/storefront ./apps/storefront

WORKDIR /app/apps/storefront
EXPOSE 3000
CMD ["node_modules/.bin/next", "start"]
