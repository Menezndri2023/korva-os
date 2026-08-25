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

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected error' },
    };
  }
}
