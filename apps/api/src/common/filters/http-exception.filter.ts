import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { captureApiException } from '../../core/observability/sentry';

interface ErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

function resolveMessage(message: unknown, fallback: string): string {
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.map(String).join(', ');
  return fallback;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const { status, error } = this.resolve(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(error.message, (exception as Error)?.stack);

      // Route path + method only — never the request body, headers, cookies, or query
      // string, which can carry passwords, tokens, or tenant PII. No-op when SENTRY_DSN is
      // unset.
      const request = ctx.getRequest<Request>();
      captureApiException(exception, {
        method: request.method,
        route: request.path,
      });
    }

    response.status(status).json({ success: false, error });
  }

  private resolve(exception: unknown): {
    status: HttpStatus;
    error: ErrorBody;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      if (typeof body === 'object' && body !== null) {
        const { message, code, ...rest } = body as Record<string, unknown>;
        return {
          status,
          error: {
            code:
              typeof code === 'string' ? code : (HttpStatus[status] ?? 'ERROR'),
            message: resolveMessage(message, exception.message),
            details: Object.keys(rest).length > 0 ? rest : undefined,
          },
        };
      }

      return {
        status,
        error: {
          code: HttpStatus[status] ?? 'ERROR',
          message: resolveMessage(body, exception.message),
        },
      };
    }

    // A MongoDB duplicate-key violation is a client-visible conflict, not a server fault, and
    // until 2026-10-14 nothing mapped it — so every unique index in the schema could answer a
    // perfectly ordinary request with a 500. That is how re-hiring a removed member behaved:
    // `addMember` inserted, the unique index on (userId, organizationId) rejected it, and the
    // caller got "Unexpected error". That specific case is now handled properly at its source
    // (OrganizationsService.addMember reactivates the membership), but there are eighteen other
    // unique indexes in this codebase and the next one will land here.
    //
    // The driver's own message is deliberately NOT forwarded: it embeds the index name and the
    // duplicate VALUE, which for the indexes here means an email address, an organization slug
    // or a customer's name. A caller already knows what it sent; it does not need confirmation
    // of which existing record it collided with.
    if (isDuplicateKeyError(exception)) {
      // Logged at warn, not error, so it does not count as a server fault in the logs or reach
      // Sentry via the >= 500 branch above — while still being visible, because a duplicate key
      // arriving here means some service skipped a check it should have made itself.
      this.logger.warn(
        `Duplicate key rejected by the database: ${describeDuplicateKey(exception)}`,
      );
      return {
        status: HttpStatus.CONFLICT,
        error: {
          code: 'DUPLICATE_KEY',
          message: 'This record already exists',
        },
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected error' },
    };
  }
}

/** MongoServerError code 11000 — the duplicate-key violation, including the bulk-write variant
 *  (11001). Shape-checked rather than `instanceof MongoServerError` so this file needs no
 *  mongodb import and keeps working across driver versions. */
function isDuplicateKeyError(exception: unknown): boolean {
  if (typeof exception !== 'object' || exception === null) return false;
  const code = (exception as { code?: unknown }).code;
  return code === 11000 || code === 11001;
}

/** The collection and index that rejected the write — enough for an operator to find the
 *  missing check, with no field VALUES, which is what carries the PII. */
function describeDuplicateKey(exception: unknown): string {
  // Only `keyPattern` is read. The driver's `message` and `keyValue` both carry the colliding
  // VALUE — an email address, a slug, a customer name — so neither is touched here.
  const keyPattern = (exception as { keyPattern?: Record<string, unknown> })
    .keyPattern;
  return keyPattern ? Object.keys(keyPattern).join('+') : 'unknown field(s)';
}
