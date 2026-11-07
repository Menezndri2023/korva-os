import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  HttpCode,
  Query,
} from '@nestjs/common';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { ApiTags } from '@nestjs/swagger';
import {
  createContactSchema,
  listContactsQuerySchema,
  mergeContactsSchema,
  updateContactSchema,
  type CreateContactInput,
  type ListContactsQuery,
  type MergeContactsInput,
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
  constructor(
    private readonly contactsService: ContactsService,
    private readonly loyaltyService: LoyaltyService,
  ) {}

  /** The customer's loyalty card: stamps, rewards available and used. */
  @RequirePermissions('contacts.read')
  @Get(':id/loyalty')
  loyalty(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.loyaltyService.forContact(tenant.organizationId, id);
  }

  /** A stamp added by hand — a visit paid in cash that KORVA never saw. */
  @RequirePermissions('contacts.update')
  @Post(':id/loyalty/stamp')
  @HttpCode(200)
  addStamp(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.loyaltyService.stampByHand(tenant.organizationId, id);
  }

  /** The customer takes their reward. */
  @RequirePermissions('contacts.update')
  @Post(':id/loyalty/redeem')
  @HttpCode(200)
  redeem(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.loyaltyService.redeem(tenant.organizationId, id);
  }

  @RequirePermissions('contacts.read')
  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listContactsQuerySchema))
    query: ListContactsQuery,
  ) {
    return this.contactsService.list(tenant.organizationId, query);
  }

  // Registered before ':id' below — Express/Nest match routes in declaration order, so this
  // literal 'duplicates' segment must come first or it would be swallowed as an ':id' value of
  // "duplicates".
  @RequirePermissions('contacts.read')
  @Get('duplicates')
  findDuplicates(@CurrentTenant() tenant: TenantContext) {
    return this.contactsService.findDuplicates(tenant.organizationId);
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

  // contacts.update (not .delete): the caller isn't deleting anything themselves — the
  // duplicate's removal is a side effect of the merge, gated the same way updating the primary
  // contact's own fields already is.
  @RequirePermissions('contacts.update')
  @Post(':id/merge')
  merge(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(mergeContactsSchema)) body: MergeContactsInput,
  ) {
    return this.contactsService.merge(
      tenant.organizationId,
      user.userId,
      id,
      body.duplicateContactId,
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
