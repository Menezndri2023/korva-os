import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  updateFulfillmentSchema,
  type UpdateFulfillmentInput,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import { FulfillmentsService } from './fulfillments.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';

@ApiTags('fulfillments')
@Controller('fulfillments')
export class FulfillmentsController {
  constructor(private readonly fulfillmentsService: FulfillmentsService) {}

  @RequirePermissions('orders.read')
  @Get()
  getForOrder(
    @CurrentTenant() tenant: TenantContext,
    @Query('orderId') orderId: string,
  ) {
    if (!orderId) {
      throw new BadRequestException({
        code: 'ORDER_ID_REQUIRED',
        message: 'orderId query param is required',
      });
    }
    return this.fulfillmentsService.getForOrder(tenant.organizationId, orderId);
  }

  @RequirePermissions('orders.update')
  @Patch(':id')
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateFulfillmentSchema))
    body: UpdateFulfillmentInput,
  ) {
    return this.fulfillmentsService.update(tenant.organizationId, id, body);
  }
}
