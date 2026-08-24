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
  createContactSchema,
  listContactsQuerySchema,
  updateContactSchema,
  type CreateContactInput,
  type ListContactsQuery,
  type UpdateContactInput,
} from '@korva/validation';
import type { AuthenticatedUser } from '../../core/tenant/request-context.types';
import type { TenantContext } from '@korva/types';
import { ContactsService } from './contacts.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';

@ApiTags('contacts')
@RequireModule('crm')
@Controller('contacts')
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @RequirePermissions('contacts.read')
  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listContactsQuerySchema))
    query: ListContactsQuery,
  ) {
    return this.contactsService.list(tenant.organizationId, query);
  }

  @RequirePermissions('contacts.read')
  @Get(':id')
  getById(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.contactsService.getById(tenant.organizationId, id);
  }

  @RequirePermissions('contacts.create')
  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createContactSchema)) body: CreateContactInput,
  ) {
    return this.contactsService.create(
      tenant.organizationId,
      user.userId,
      body,
    );
  }

  @RequirePermissions('contacts.update')
  @Patch(':id')
  update(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateContactSchema)) body: UpdateContactInput,
  ) {
    return this.contactsService.update(
      tenant.organizationId,
      user.userId,
      id,
      body,
    );
  }

  @RequirePermissions('contacts.delete')
  @Delete(':id')
  async remove(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    await this.contactsService.delete(tenant.organizationId, user.userId, id);
    return { deleted: true };
  }
}
