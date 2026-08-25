import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  createExpenseSchema,
  listExpensesQuerySchema,
  updateExpenseSchema,
  type CreateExpenseInput,
  type ListExpensesQuery,
  type UpdateExpenseInput,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import type { AuthenticatedUser } from '../../core/tenant/request-context.types';
import { ExpensesService } from './expenses.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';

/**
 * RBAC note: there is no dedicated `expenses.*` permission in the taxonomy
 * (packages/types/src/rbac.ts) — this module reuses `invoices.read`/`invoices.create`/
 * `invoices.update`, the closest existing "financial document" permissions, granting the same
 * roles (OWNER/ADMIN/MANAGER/FINANCE write, STAFF/SALES read-only for read, MANAGER/FINANCE for
 * write) access to Expenses as they already have to Invoices. See the Wave 2 Agent D final
 * report for why: this file is outside this wave's rbac.ts ownership boundary.
 */
@ApiTags('expenses')
@RequireModule('finance')
@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @RequirePermissions('invoices.read')
  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listExpensesQuerySchema))
    query: ListExpensesQuery,
  ) {
    return this.expensesService.list(tenant.organizationId, query);
  }

  @RequirePermissions('invoices.read')
  @Get(':id')
  getById(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.expensesService.getById(tenant.organizationId, id);
  }

  @RequirePermissions('invoices.create')
  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createExpenseSchema)) body: CreateExpenseInput,
  ) {
    return this.expensesService.create(
      tenant.organizationId,
      user.userId,
      body,
    );
  }

  @RequirePermissions('invoices.update')
  @Patch(':id')
  update(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateExpenseSchema)) body: UpdateExpenseInput,
  ) {
    return this.expensesService.update(
      tenant.organizationId,
      user.userId,
      id,
      body,
    );
  }

  @RequirePermissions('invoices.update')
  @Post(':id/void')
  void(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.expensesService.void(tenant.organizationId, user.userId, id);
  }

  @RequirePermissions('invoices.update')
  @Delete(':id')
  async remove(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    await this.expensesService.delete(tenant.organizationId, user.userId, id);
    return { deleted: true };
  }
}
