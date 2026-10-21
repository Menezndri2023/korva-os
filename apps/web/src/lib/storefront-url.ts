/**
 * Base URL of the public sites (`{STOREFRONT_URL}/{slug}`), for every link the dashboard draws to
 * an owner's site. One constant instead of six copies of the same fallback.
 *
 * NEXT_PUBLIC_*, so Next inlines it at BUILD time: production gets it from the
 * NEXT_PUBLIC_STOREFRONT_URL build arg in docker-compose.prod.yml. The localhost fallback is for
 * development only — production-build-config.test.ts fails the build if the arg is not passed.
 */
export const STOREFRONT_URL = (
  process.env.NEXT_PUBLIC_STOREFRONT_URL ?? "http://localhost:3001"
).replace(/\/$/, "");
