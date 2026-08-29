import type { NextFunction, Request, Response } from 'express';

/** Must match app.setGlobalPrefix('api/v1') in main.ts plus PublicController's own
 *  'public/:organizationSlug' prefix. */
const PUBLIC_API_PREFIX = '/api/v1/public/';

/**
 * The `/public/*` storefront/widget API is deliberately reachable from ANY origin — an
 * embeddable widget (apps/storefront/public/korva-widget.js) has to work when dropped into an
 * arbitrary third-party business's own website, whose domain can never be known in advance,
 * unlike the dashboard's strict CORS_ORIGINS allowlist applied below this in main.ts. Safe
 * specifically because every /public/* handler already re-derives organizationId from the URL
 * slug and re-verifies everything server-side (see public.service.ts's own doc comment — price/
 * total/contact are never trusted from the caller), and because this API never sets cookies or
 * reads credentials: true, so there is no session to leak cross-origin.
 *
 * Registered in main.ts BEFORE app.enableCors(strict allowlist) — for any other path this is a
 * no-op (calls next() immediately). For a /public/* request it sets permissive headers and lets
 * the strict CORS middleware run afterward too: the `cors` package only ever calls
 * res.setHeader for Access-Control-Allow-Origin when the origin actually matches its own
 * allowlist (confirmed against the installed cors@2.8.6 source — it simply skips setting the
 * header otherwise), so it can never downgrade or remove what this middleware already set.
 */
export function publicCorsMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.path.startsWith(PUBLIC_API_PREFIX)) {
    next();
    return;
  }

  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
}
