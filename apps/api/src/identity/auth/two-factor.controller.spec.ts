import 'reflect-metadata';
import { TwoFactorController } from './two-factor.controller';

const THROTTLER_LIMIT_DEFAULT = 'THROTTLER:LIMITdefault';
const THROTTLER_TTL_DEFAULT = 'THROTTLER:TTLdefault';

const prototype = TwoFactorController.prototype as unknown as Record<
  string,
  unknown
>;

function getThrottleMetadata(
  key: string,
  methodName: string,
): number | undefined {
  return Reflect.getMetadata(key, prototype[methodName] as object) as number;
}

describe('TwoFactorController — brute-force throttling on code verification', () => {
  // Before this fix, /auth/2fa/confirm and /auth/2fa/disable carried no @Throttle at all and
  // fell back to the generic global guard (120 req/min, see ThrottlerModule.forRoot in
  // app.module.ts) — far too loose a bound for guessing a 6-digit TOTP code (1,000,000
  // possibilities), especially since — unlike /auth/login — these endpoints share no lockout
  // counter with password attempts (see AuthService.registerFailedAttempt).
  it('applies a dedicated throttle to confirm, matching AuthController.AUTH_THROTTLE', () => {
    expect(getThrottleMetadata(THROTTLER_LIMIT_DEFAULT, 'confirm')).toBe(30);
    expect(getThrottleMetadata(THROTTLER_TTL_DEFAULT, 'confirm')).toBe(60_000);
  });

  it('applies a dedicated throttle to disable, matching AuthController.AUTH_THROTTLE', () => {
    expect(getThrottleMetadata(THROTTLER_LIMIT_DEFAULT, 'disable')).toBe(30);
    expect(getThrottleMetadata(THROTTLER_TTL_DEFAULT, 'disable')).toBe(60_000);
  });

  it('leaves setup on the generic global guard (unchanged behavior — no code is verified there)', () => {
    expect(
      getThrottleMetadata(THROTTLER_LIMIT_DEFAULT, 'setup'),
    ).toBeUndefined();
  });
});
