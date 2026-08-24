import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  availabilityQuerySchema,
  type AvailabilityQuery,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import { AvailabilityService } from './availability.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';

@ApiTags('availability')
@RequireModule('booking')
@Controller('availability')
export class AvailabilityController {
  constructor(private readonly availabilityService: AvailabilityService) {}

  @RequirePermissions('bookings.read')
  @Get()
  get(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(availabilityQuerySchema))
    query: AvailabilityQuery,
  ) {
    return this.availabilityService.getDayAvailability(
      tenant.organizationId,
      query.resourceId,
      query.date,
    );
  }
}
