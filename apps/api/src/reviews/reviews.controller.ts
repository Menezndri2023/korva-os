import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  listReviewsQuerySchema,
  replyToReviewSchema,
  updateReviewStatusSchema,
  type ListReviewsQuery,
  type ReplyToReviewInput,
  type UpdateReviewStatusInput,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import { ReviewsService } from './reviews.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';

/** Staff never write or edit a review — customers do (see Review's class doc). Staff read them
 *  (`orders.read`), answer publicly and take one off the site (`orders.update`): a review is
 *  order/booking-adjacent, not worth a permission category of its own. */
@ApiTags('reviews')
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @RequirePermissions('orders.read')
  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listReviewsQuerySchema))
    query: ListReviewsQuery,
  ) {
    return this.reviewsService.list(tenant.organizationId, query);
  }

  @RequirePermissions('orders.read')
  @Get('stats')
  stats(@CurrentTenant() tenant: TenantContext) {
    return this.reviewsService.stats(tenant.organizationId);
  }

  @RequirePermissions('orders.update')
  @Patch(':id/status')
  setStatus(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateReviewStatusSchema))
    body: UpdateReviewStatusInput,
  ) {
    return this.reviewsService.setStatus(
      tenant.organizationId,
      id,
      body.status,
    );
  }

  @RequirePermissions('orders.update')
  @Patch(':id/reply')
  reply(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(replyToReviewSchema)) body: ReplyToReviewInput,
  ) {
    return this.reviewsService.reply(tenant.organizationId, id, body.body);
  }
}
