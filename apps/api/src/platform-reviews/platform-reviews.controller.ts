import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  upsertPlatformReviewSchema,
  type UpsertPlatformReviewInput,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import type { AuthenticatedUser } from '../core/tenant/request-context.types';
import { PlatformReviewsService } from './platform-reviews.service';

/** Any member of a business can say what they think of KORVA — no permission needed. */
@ApiTags('platform-reviews')
@Controller('platform-reviews')
export class PlatformReviewsController {
  constructor(private readonly service: PlatformReviewsService) {}

  @Get('me')
  async mine(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenant: TenantContext,
  ) {
    // `null` rather than a 404: "not written yet" is the normal first state of the page.
    return (
      (await this.service.getMine(user.userId, tenant.organizationId)) ?? null
    );
  }

  @Patch('me')
  upsert(
    @CurrentUser() user: AuthenticatedUser,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(upsertPlatformReviewSchema))
    body: UpsertPlatformReviewInput,
  ) {
    return this.service.upsertMine(user.userId, tenant.organizationId, body);
  }
}

/** korvasuite.com's "Ils utilisent KORVA" — published reviews whose authors agreed to it. */
@ApiTags('platform-reviews')
@Public()
@Controller('public-platform-reviews')
export class PublicPlatformReviewsController {
  constructor(private readonly service: PlatformReviewsService) {}

  @Get()
  list() {
    return this.service.publicSummary();
  }
}
