import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  createCategorySchema,
  updateCategorySchema,
  type CreateCategoryInput,
  type UpdateCategoryInput,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import type { AuthenticatedUser } from '../../core/tenant/request-context.types';
import { CategoriesService } from './categories.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';

// Gated with the existing offers.* permissions (see packages/types/src/rbac.ts) rather than new
// categories.* ones: Category management is a catalog sub-resource with no dedicated permission
// of its own defined in RBAC, and adding one is outside this change's ownership boundary
// (rbac.ts). Reusing offers.* keeps access aligned with who already manages the catalog.
@ApiTags('categories')
@RequireModule('catalog')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @RequirePermissions('offers.read')
  @Get()
  list(@CurrentTenant() tenant: TenantContext) {
    return this.categoriesService.list(tenant.organizationId);
  }

  @RequirePermissions('offers.read')
  @Get(':id')
  getById(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.categoriesService.getById(tenant.organizationId, id);
  }

  @RequirePermissions('offers.create')
  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createCategorySchema))
    body: CreateCategoryInput,
  ) {
    return this.categoriesService.create(
      tenant.organizationId,
      user.userId,
      body,
    );
  }

  @RequirePermissions('offers.update')
  @Patch(':id')
  update(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCategorySchema))
    body: UpdateCategoryInput,
  ) {
    return this.categoriesService.update(
      tenant.organizationId,
      user.userId,
      id,
      body,
    );
  }

  @RequirePermissions('offers.delete')
  @Delete(':id')
  async remove(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    await this.categoriesService.delete(tenant.organizationId, user.userId, id);
    return { deleted: true };
  }
}
