import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  listReviewsQuerySchema,
  type ListReviewsQuery,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import { ReviewsService } from './reviews.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';

/** Read-only for staff — reviews are only ever created by a customer through the customer
 *  portal (see CustomerAuthController). Gated on `orders.read` (see Review's own class doc for
 *  why this reuses an existing permission rather than introducing a new resource category). */
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
}
