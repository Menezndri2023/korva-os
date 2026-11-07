import * as Sentry from '@sentry/node';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * P0-OBSERVABILITY-01 (backend scope): minimal Sentry error-tracking wiring.
 *
 * Deliberately narrow — error capture only, no performance tracing/metrics (see
 * docs/audits for the full P0/P1 breakdown; tracing is a separate, lower-priority item).
 *
 * Entirely optional: when SENTRY_DSN is unset, `initSentry()` is a no-op and
 * `captureApiException()` short-circuits, so the app boots and behaves exactly as it did
 * before this module existed — mirrors how AiModule falls back to NullAIProvider when
 * AI_API_KEY is absent, and CommunicationModule falls back to LogEmailProvider when
 * RESEND_API_KEY is absent.
 */

function readPackageVersion(): string | undefined {
  try {
    // Walk upward from this file's own directory looking for apps/api/package.json, rather
    // than assuming a fixed depth: `nest build`'s dist/ layout (dist/src/...) differs from
    // ts-node's (src/... directly), so a hardcoded '../../../package.json' silently resolves
    // to the wrong place under one of the two. Match on "name" to make sure we land on
    // apps/api's own package.json, not e.g. the workspace root's.
    let dir = __dirname;
    for (let i = 0; i < 8; i++) {
      const candidate = join(dir, 'package.json');
      if (existsSync(candidate)) {
        const parsed = JSON.parse(readFileSync(candidate, 'utf-8')) as {
          name?: string;
          version?: string;
        };
        if (parsed.name === '@korva/api') return parsed.version;
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function initSentry(): void {
  // Read directly from process.env, not ConfigService: this runs at the very start of
  // bootstrap(), before NestFactory.create() — so Nest's DI container (and ConfigService
  // with it) doesn't exist yet. This also means a crash during app/module initialization
  // itself (e.g. Mongoose failing to connect) is still capturable, via the bootstrap().catch
  // handler in main.ts.
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment:
      process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
    release: process.env.SENTRY_RELEASE ?? readPackageVersion(),
    // Error tracking only for this lot — no perf/tracing spans.
    tracesSampleRate: 0,
    // Belt-and-braces against secret/PII leakage, on top of never passing request bodies,
    // auth headers, or cookies into captureApiException's context in the first place:
    // - sendDefaultPii: false (the SDK default, made explicit here) stops the Node SDK's
    //   default HTTP integration from attaching client IPs or raw request headers/cookies.
    // - beforeSend strips those same fields defensively, in case any future integration or
    //   SDK upgrade ever attaches an `event.request` we didn't build ourselves.
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        delete event.request.headers;
      }
      return event;
    },
  });
}

/**
 * Reports an exception to Sentry with a small, explicitly whitelisted context — HTTP method
 * and route path only. Never pass request bodies, headers, cookies, or query strings here:
 * those can carry passwords, tokens, or other tenant PII.
 *
 * No-op (safe to call unconditionally) when Sentry was never initialized, i.e. SENTRY_DSN is
 * unset.
 */
export function captureApiException(
  exception: unknown,
  context: { method: string; route: string },
): void {
  if (!Sentry.getClient()) return;

  Sentry.withScope((scope) => {
    scope.setTag('http.method', context.method);
    scope.setTag('http.route', context.route);
    Sentry.captureException(exception);
  });
}

/**
 * An error from a visitor's browser (apps/web or apps/storefront), forwarded by
 * ClientErrorsController — before it, a crash on a customer's phone was seen by nobody. Only
 * the page's path (never its query string: the tracking page carries an e-mail there), the
 * message and the stack are kept.
 */
export function captureClientError(report: {
  app: 'web' | 'storefront';
  message: string;
  stack?: string;
  path: string;
  release?: string;
}): void {
  if (!Sentry.getClient()) return;
  const error = new Error(report.message);
  error.name = 'ClientError';
  if (report.stack) error.stack = report.stack;
  Sentry.withScope((scope) => {
    scope.setTag('client.app', report.app);
    scope.setTag('client.path', report.path);
    if (report.release) scope.setTag('client.release', report.release);
    Sentry.captureException(error);
  });
}
