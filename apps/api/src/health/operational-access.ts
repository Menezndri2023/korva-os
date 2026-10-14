import { ForbiddenException } from '@nestjs/common';

/**
 * The access rule shared by the two routes that expose operational state — `GET /metrics` and
 * `GET /health/queues`. Both are `@Public()` because a scraper cannot present a tenant JWT, and
 * both reveal the same thing: every queue's name and its job counts.
 *
 * WHY THIS EXISTS AS ONE FUNCTION. MetricsController had its own private `assertAuthorized` and
 * `/health/queues` had no check at all, even though they return the same data — so the Caddyfile
 * blocked `/api/v1/metrics` at the edge for exposing operational state while
 * `/api/v1/health/queues` answered 200 to the internet. One rule in one place is what stops the
 * two drifting apart again.
 *
 * WHY IT FAILS CLOSED IN PRODUCTION. The previous rule was `if (!expected) return;` — an unset
 * token meant *no* check, so the safest-looking configuration (leave it blank) was the most
 * open one. Production ran that way: METRICS_TOKEN was empty and the edge 404 was the only
 * control, while the Caddyfile's comment claimed the application guarded it too. Outside
 * production an unset token still means open, which keeps local development and the e2e suite
 * working without ceremony; inside production, unset now means closed.
 *
 * This is still not the whole defence. Operational state is state: keep the ingress rule as
 * well, so a misconfigured token cannot expose it.
 */
export function assertOperationalAccess(
  expectedToken: string | undefined,
  authorization: string | undefined,
  nodeEnv: string | undefined,
): void {
  const token = expectedToken?.trim();

  if (!token) {
    if (nodeEnv === 'production') {
      throw new ForbiddenException({
        code: 'METRICS_NOT_CONFIGURED',
        message:
          'Operational metrics are disabled: METRICS_TOKEN is not set on this deployment',
      });
    }
    // Development and test: open, as it always was.
    return;
  }

  if (authorization !== `Bearer ${token}`) {
    throw new ForbiddenException({
      code: 'METRICS_FORBIDDEN',
      message: 'Invalid metrics token',
    });
  }
}
