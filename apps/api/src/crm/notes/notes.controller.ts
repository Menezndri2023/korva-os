import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createNoteSchema, type CreateNoteInput } from '@korva/validation';
import type { TenantContext } from '@korva/types';
import type { AuthenticatedUser } from '../../core/tenant/request-context.types';
import { NotesService } from './notes.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';

@ApiTags('notes')
@Controller('notes')
export class NotesController {
  constructor(private readonly notesService: NotesService) {}

  @RequirePermissions('contacts.read')
  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query('entity') entity: string,
    @Query('entityId') entityId: string,
  ) {
    if ((entity !== 'contact' && entity !== 'lead') || !entityId) {
      throw new BadRequestException({
        code: 'INVALID_QUERY',
        message: 'entity ("contact" or "lead") and entityId are required',
      });
    }
    return this.notesService.listForEntity(
      tenant.organizationId,
      entity,
      entityId,
    );
  }

  @RequirePermissions('contacts.update')
  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createNoteSchema)) body: CreateNoteInput,
  ) {
    return this.notesService.create(tenant.organizationId, user.userId, body);
  }
}
