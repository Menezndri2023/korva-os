import 'reflect-metadata';
import { InvitationsAcceptController } from './invitations.controller';

const THROTTLER_LIMIT_DEFAULT = 'THROTTLER:LIMITdefault';
const THROTTLER_TTL_DEFAULT = 'THROTTLER:TTLdefault';

const prototype = InvitationsAcceptController.prototype as unknown as Record<
  string,
  unknown
>;

function getThrottleMetadata(
  key: string,
  methodName: string,
): number | undefined {
  return Reflect.getMetadata(key, prototype[methodName] as object) as number;
}

describe('InvitationsAcceptController — throttling on the public accept endpoint', () => {
  // Before this fix, POST /invitations/:token/accept was @Public() with no @Throttle, falling
  // back to the generic global guard (120 req/min). The token itself is unguessable (32 random
  // bytes), but the endpoint is still an unauthenticated, account-adjacent surface — a
  // successful call creates a membership and, for an unknown email, a brand-new user account —
  // so it should carry the same dedicated bound as the rest of the auth-adjacent public routes
  // (see AuthController.AUTH_THROTTLE).
  it('applies a dedicated throttle to accept, matching AuthController.AUTH_THROTTLE', () => {
    expect(getThrottleMetadata(THROTTLER_LIMIT_DEFAULT, 'accept')).toBe(30);
    expect(getThrottleMetadata(THROTTLER_TTL_DEFAULT, 'accept')).toBe(60_000);
  });
});
