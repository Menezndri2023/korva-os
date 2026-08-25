import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { runWithRequestContext } from '../logging/request-context';

export interface RequestWithId extends Request {
  id: string;
}

const REQUEST_ID_HEADER = 'x-request-id';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Assigns every request a stable id, reusing a client-supplied X-Request-ID only when it's a
 * well-formed UUID — an arbitrary client value is never trusted or logged as-is (log-forging
 * risk); it's silently replaced with a fresh server-generated id instead of rejecting the
 * request. Attached to `req.id` and echoed on the response so a single request can be
 * correlated end-to-end.
 *
 * `next()` runs inside an AsyncLocalStorage context carrying that id (see
 * common/logging/request-context.ts), so every `Logger` call made anywhere downstream — guards,
 * interceptors, controllers, services, however many `await`s deep — picks it up automatically
 * via StructuredLogger without having to thread it through every function signature. Still
 * deliberately local to *this process's* request lifecycle only: it is not propagated to
 * outbound calls (Anthropic/Resend/webhooks) or BullMQ job payloads; nothing in this codebase
 * today needs more than that (see the pre-implementation audit for this lot).
 */
export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
  const id =
    candidate && UUID_PATTERN.test(candidate) ? candidate : randomUUID();

  (req as RequestWithId).id = id;
  res.setHeader('X-Request-ID', id);
  runWithRequestContext({ requestId: id }, next);
}
