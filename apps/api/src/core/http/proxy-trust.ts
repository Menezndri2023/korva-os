import type { NestExpressApplication } from '@nestjs/platform-express';

/**
 * The API is only ever reached through a relay on the private network: Caddy for the public,
 * the storefront server for the pages it renders. Without this, Express saw every request coming
 * from Caddy's own address, so the per-IP rate limit (ThrottlerGuard) was ONE bucket of 120
 * requests/minute shared by the whole platform — every merchant, every visitor.
 *
 * X-Forwarded-For is trusted only when the immediate peer is a private address, which keeps it
 * unspoofable: a header a visitor forges arrives through Caddy, which records the real client
 * address after it, and Express stops at the first address it does not trust.
 *
 * Shared by main.ts and the e2e test that proves it, so the tested setting is the deployed one.
 */
export function configureProxyTrust(app: NestExpressApplication): void {
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');
}
