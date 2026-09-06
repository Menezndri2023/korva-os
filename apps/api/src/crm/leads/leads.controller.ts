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
  convertLeadSchema,
  createLeadSchema,
  listLeadsQuerySchema,
  updateLeadSchema,
  type ConvertLeadInput,
  type CreateLeadInput,
  type ListLeadsQuery,
  type UpdateLeadInput,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import type { AuthenticatedUser } from '../../core/tenant/request-context.types';
import { LeadsService } from './leads.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';

@ApiTags('leads')
@RequireModule('crm')
@Controller('leads')
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @RequirePermissions('leads.read')
  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listLeadsQuerySchema)) query: ListLeadsQuery,
  ) {
    return this.leadsService.list(tenant.organizationId, query);
  }

  @RequirePermissions('leads.read')
  @Get(':id')
  getById(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.leadsService.getById(tenant.organizationId, id);
  }

  @RequirePermissions('leads.read')
  @Get(':id/score')
  getScore(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.leadsService.getScore(tenant.organizationId, id);
  }

  @RequirePermissions('leads.create')
  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createLeadSchema)) body: CreateLeadInput,
  ) {
    return this.leadsService.create(tenant.organizationId, user.userId, body);
  }

  @RequirePermissions('leads.update')
  @Patch(':id')
  update(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateLeadSchema)) body: UpdateLeadInput,
  ) {
    return this.leadsService.update(
      tenant.organizationId,
      user.userId,
      id,
      body,
    );
  }

  @RequirePermissions('leads.update')
  @Post(':id/convert')
  convert(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(convertLeadSchema)) body: ConvertLeadInput,
  ) {
    return this.leadsService.convertToDeal(
      tenant.organizationId,
      user.userId,
      id,
      body,
    );
  }
}
