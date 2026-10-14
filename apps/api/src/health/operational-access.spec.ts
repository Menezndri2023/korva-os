import { ForbiddenException } from '@nestjs/common';
import { assertOperationalAccess } from './operational-access';

/**
 * The rule guarding the two routes that expose operational state, `GET /metrics` and
 * `GET /health/queues`. The case that matters most is the third describe: an unset token used to
 * mean "no check", so the blankest configuration was the most open one, and production shipped
 * exactly that.
 */
describe('assertOperationalAccess', () => {
  /** Asserts `fn` throws a ForbiddenException carrying `code`. */
  function expectForbidden(fn: () => void, code: string): void {
    expect(fn).toThrow(ForbiddenException);
    try {
      fn();
      throw new Error('expected a ForbiddenException');
    } catch (error) {
      expect((error as ForbiddenException).getResponse()).toMatchObject({
        code,
      });
    }
  }

  describe('with a token configured', () => {
    it('allows a request carrying exactly that bearer token', () => {
      expect(() =>
        assertOperationalAccess('s3cret', 'Bearer s3cret', 'production'),
      ).not.toThrow();
    });

    it('rejects a wrong token, a missing header, and a bare token with no scheme', () => {
      for (const header of [
        'Bearer wrong',
        undefined,
        's3cret',
        'bearer s3cret', // case-sensitive on purpose: the scheme is part of the match
      ]) {
        expectForbidden(
          () => assertOperationalAccess('s3cret', header, 'production'),
          'METRICS_FORBIDDEN',
        );
      }
    });

    it('still enforces the token outside production', () => {
      expectForbidden(
        () => assertOperationalAccess('s3cret', 'Bearer wrong', 'development'),
        'METRICS_FORBIDDEN',
      );
    });
  });

  describe('with no token in development or test', () => {
    it.each(['development', 'test', undefined])(
      'stays open when NODE_ENV is %s, so local work and the e2e suite need no ceremony',
      (nodeEnv) => {
        expect(() =>
          assertOperationalAccess(undefined, undefined, nodeEnv),
        ).not.toThrow();
      },
    );
  });

  describe('with no token in production — fails closed', () => {
    it('denies the route rather than opening it', () => {
      expectForbidden(
        () => assertOperationalAccess(undefined, undefined, 'production'),
        'METRICS_NOT_CONFIGURED',
      );
    });

    it('denies it even when the caller presents some bearer token', () => {
      // There is nothing to compare against, so no credential can be right. The alternative —
      // accepting any token when none is configured — would be worse than being open, because
      // it would look authenticated in a log.
      expectForbidden(
        () =>
          assertOperationalAccess(undefined, 'Bearer anything', 'production'),
        'METRICS_NOT_CONFIGURED',
      );
    });

    it.each(['', '   '])(
      'treats %p as unset — a blank or whitespace env var is the shape this actually took in production',
      (token) => {
        expectForbidden(
          () => assertOperationalAccess(token, 'Bearer anything', 'production'),
          'METRICS_NOT_CONFIGURED',
        );
      },
    );
  });
});
