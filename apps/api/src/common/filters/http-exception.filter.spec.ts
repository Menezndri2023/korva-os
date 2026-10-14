import {
  ArgumentsHost,
  ForbiddenException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

jest.mock('../../core/observability/sentry', () => ({
  captureApiException: jest.fn(),
}));
import { captureApiException } from '../../core/observability/sentry';

/** Minimal ArgumentsHost: captures the status and JSON body the filter writes. */
function buildHost(path = '/api/v1/organizations/me/members') {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ method: 'POST', path }),
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('HttpExceptionFilter', () => {
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    (captureApiException as jest.Mock).mockClear();
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  /**
   * A duplicate-key violation is a client-visible conflict, not a server fault. Nothing mapped
   * it until 2026-10-14, so any of this codebase's nineteen unique indexes could answer an
   * ordinary request with a 500 — which is exactly how re-hiring a removed member behaved.
   */
  describe('MongoDB duplicate key', () => {
    function duplicateKeyError(keyPattern?: Record<string, number>) {
      return Object.assign(
        new Error(
          'E11000 duplicate key error collection: korva.memberships index: ' +
            'userId_1_organizationId_1 dup key: { userId: "marie@boutique.test" }',
        ),
        {
          code: 11000,
          keyPattern,
          keyValue: { userId: 'marie@boutique.test' },
        },
      );
    }

    it('answers 409 DUPLICATE_KEY instead of 500', () => {
      const { host, status, json } = buildHost();
      new HttpExceptionFilter().catch(
        duplicateKeyError({ userId: 1, organizationId: 1 }),
        host,
      );

      expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
      expect(json).toHaveBeenCalledWith({
        success: false,
        error: { code: 'DUPLICATE_KEY', message: 'This record already exists' },
      });
    });

    it('never echoes the colliding value, which is where the PII is', () => {
      const { host, json } = buildHost();
      new HttpExceptionFilter().catch(
        duplicateKeyError({ userId: 1, organizationId: 1 }),
        host,
      );

      // The driver's message and keyValue both carry the address. Neither may reach the client,
      // and neither may reach the log line either.
      const serialized = JSON.stringify(json.mock.calls[0]);
      expect(serialized).not.toContain('marie@boutique.test');
      expect(serialized).not.toContain('E11000');
      for (const call of warnSpy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain('marie@boutique.test');
      }
    });

    it('logs the index shape at warn, and does not report it to Sentry as a server fault', () => {
      const { host } = buildHost();
      new HttpExceptionFilter().catch(
        duplicateKeyError({ userId: 1, organizationId: 1 }),
        host,
      );

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('userId+organizationId'),
      );
      expect(errorSpy).not.toHaveBeenCalled();
      // A duplicate key is a caller's problem, not an outage. Paging on it would train whoever
      // reads Sentry to ignore it.
      expect(captureApiException).not.toHaveBeenCalled();
    });

    it('still answers 409 when the driver reports no keyPattern', () => {
      const { host, status } = buildHost();
      new HttpExceptionFilter().catch(duplicateKeyError(undefined), host);
      expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('unknown field(s)'),
      );
    });

    it('also covers the bulk-write variant, code 11001', () => {
      const { host, status } = buildHost();
      new HttpExceptionFilter().catch(
        Object.assign(new Error('bulk dup'), { code: 11001 }),
        host,
      );
      expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    });

    it('does not mistake an unrelated error that happens to carry a `code` for one', () => {
      const { host, status } = buildHost();
      // ioredis, fs and the AWS SDK all attach string `code` values. None is a conflict.
      new HttpExceptionFilter().catch(
        Object.assign(new Error('connect ECONNREFUSED'), {
          code: 'ECONNREFUSED',
        }),
        host,
      );
      expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    });
  });

  describe('existing behaviour is unchanged', () => {
    it('passes an HttpException through, collecting its extra keys into `details`', () => {
      const { host, status, json } = buildHost();
      // Note the shape: extra keys go at the TOP level of the exception body and the filter
      // gathers whatever is left after `code` and `message` into `details`. Passing a literal
      // `details` key instead produces `details.details`, which is how this test was wrong
      // before — worth asserting, because every `throw new ForbiddenException({...})` in the
      // services relies on this convention.
      new HttpExceptionFilter().catch(
        new ForbiddenException({
          code: 'SEAT_LIMIT_REACHED',
          message: 'No seat available',
          seatLimit: 1,
        }),
        host,
      );

      expect(status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
      expect(json).toHaveBeenCalledWith({
        success: false,
        error: {
          code: 'SEAT_LIMIT_REACHED',
          message: 'No seat available',
          details: { seatLimit: 1 },
        },
      });
    });

    it('hides an unknown error behind 500 and reports it to Sentry', () => {
      const { host, status, json } = buildHost();
      new HttpExceptionFilter().catch(
        new Error('redis://user:hunter2@host is down'),
        host,
      );

      expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      // The internal message must never reach the client — it can carry a connection string.
      expect(JSON.stringify(json.mock.calls[0])).not.toContain('hunter2');
      expect(captureApiException).toHaveBeenCalledTimes(1);
    });
  });
});
