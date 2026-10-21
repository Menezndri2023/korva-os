import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  platformAdminLoginSchema,
  platformAdminPasswordSchema,
  type PlatformAdminLoginInput,
  type PlatformAdminPasswordInput,
} from '@korva/validation';
import { Public } from '../common/decorators/public.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  PlatformAdminAuthService,
  type PlatformAdminIdentity,
} from './platform-admin-auth.service';
import {
  CurrentPlatformAdmin,
  PlatformAdminGuard,
} from './platform-admin.guard';

/** Tighter than the businesses' sign-in: there are a handful of administrators, not thousands. */
const ADMIN_LOGIN_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

/** Sign-in to KORVA's administration — its own accounts and tokens, see PlatformAdminAuthService. */
@ApiTags('platform')
@Public()
@Controller('platform/auth')
export class PlatformAdminAuthController {
  constructor(private readonly auth: PlatformAdminAuthService) {}

  @Post('login')
  @HttpCode(200)
  @Throttle(ADMIN_LOGIN_THROTTLE)
  login(
    @Body(new ZodValidationPipe(platformAdminLoginSchema))
    body: PlatformAdminLoginInput,
  ) {
    return this.auth.login(body.email, body.password);
  }

  @Post('password')
  @HttpCode(200)
  @UseGuards(PlatformAdminGuard)
  async changePassword(
    @CurrentPlatformAdmin() admin: PlatformAdminIdentity,
    @Body(new ZodValidationPipe(platformAdminPasswordSchema))
    body: PlatformAdminPasswordInput,
  ) {
    await this.auth.changePassword(
      admin.id,
      body.currentPassword,
      body.newPassword,
    );
    return { changed: true };
  }
}
