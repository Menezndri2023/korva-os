import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { totpCodeSchema, type TotpCodeInput } from '@korva/validation';
import { TwoFactorService } from './two-factor.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SkipTenant } from '../../common/decorators/skip-tenant.decorator';
import type { AuthenticatedUser } from '../../core/tenant/request-context.types';

/** Same rationale and value as AuthController's AUTH_THROTTLE: a 6-digit TOTP code is only
 *  1,000,000 possibilities, and unlike /auth/login (which also requires the account password,
 *  and shares the same login lockout counter — see AuthService.registerFailedAttempt), `confirm`
 *  and `disable` here only require a valid access token. Without a dedicated throttle, both would
 *  otherwise fall back to the generic global 120-req/min guard (see ThrottlerModule.forRoot in
 *  app.module.ts) — far too loose a bound on a code-guessing target. */
const TOTP_VERIFY_THROTTLE = { default: { limit: 30, ttl: 60_000 } };

/**
 * All routes here require a real Bearer access token (no @Public()) but never a resolved
 * organization — 2FA is an account-level (User) setting, not a per-tenant one, so every
 * handler carries @SkipTenant() the same way `organizations/me/all` does.
 */
@ApiTags('auth')
@SkipTenant()
@Controller('auth/2fa')
export class TwoFactorController {
  constructor(private readonly twoFactorService: TwoFactorService) {}

  @Post('setup')
  setup(@CurrentUser() user: AuthenticatedUser) {
    return this.twoFactorService.beginEnrollment(user.userId, user.email);
  }

  @Throttle(TOTP_VERIFY_THROTTLE)
  @Post('confirm')
  async confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(totpCodeSchema)) body: TotpCodeInput,
  ) {
    await this.twoFactorService.confirmEnrollment(user.userId, body.code);
    return { enabled: true };
  }

  @Throttle(TOTP_VERIFY_THROTTLE)
  @Post('disable')
  async disable(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(totpCodeSchema)) body: TotpCodeInput,
  ) {
    // Requires a currently-valid code (not just being logged in) so a hijacked access token
    // alone can never turn 2FA off — the same "possession of the second factor" bar as logging
    // in with it in the first place.
    await this.twoFactorService.confirmDisable(user.userId, body.code);
    return { enabled: false };
  }
}
