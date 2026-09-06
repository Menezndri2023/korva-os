import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  assignTicketSchema,
  createTicketSchema,
  listTicketsQuerySchema,
  updateTicketSchema,
  type AssignTicketInput,
  type CreateTicketInput,
  type ListTicketsQuery,
  type UpdateTicketInput,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import type { AuthenticatedUser } from '../../core/tenant/request-context.types';
import { TicketsService } from './tickets.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';

@ApiTags('tickets')
@RequireModule('crm')
@Controller('tickets')
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @RequirePermissions('tickets.read')
  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listTicketsQuerySchema))
    query: ListTicketsQuery,
  ) {
    return this.ticketsService.list(tenant.organizationId, query);
  }

  @RequirePermissions('tickets.read')
  @Get(':id')
  getById(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.ticketsService.getById(tenant.organizationId, id);
  }

  @RequirePermissions('tickets.create')
  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createTicketSchema)) body: CreateTicketInput,
  ) {
    return this.ticketsService.create(tenant.organizationId, user.userId, body);
  }

  @RequirePermissions('tickets.update')
  @Patch(':id')
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateTicketSchema)) body: UpdateTicketInput,
  ) {
    return this.ticketsService.update(tenant.organizationId, id, body);
  }

  @RequirePermissions('tickets.assign')
  @Post(':id/assign')
  assign(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(assignTicketSchema)) body: AssignTicketInput,
  ) {
    return this.ticketsService.assign(
      tenant.organizationId,
      user.userId,
      id,
      body,
    );
  }

  @RequirePermissions('tickets.update')
  @Post(':id/resolve')
  resolve(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.ticketsService.resolve(tenant.organizationId, user.userId, id);
  }

  @RequirePermissions('tickets.update')
  @Post(':id/close')
  close(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.ticketsService.close(tenant.organizationId, user.userId, id);
  }

  @RequirePermissions('tickets.update')
  @Post(':id/reopen')
  reopen(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.ticketsService.reopen(tenant.organizationId, user.userId, id);
  }
}
