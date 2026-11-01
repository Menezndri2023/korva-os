import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  createPlatformNoteSchema,
  platformFinanceQuerySchema,
  type CreatePlatformNoteInput,
  type PlatformFinanceQuery,
} from '@korva/validation';
import { Public } from '../common/decorators/public.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  CurrentPlatformAdmin,
  PlatformAdminGuard,
} from './platform-admin.guard';
import type { PlatformAdminIdentity } from './platform-admin-auth.service';
import { PlatformInsightsService } from './platform-insights.service';

/** What needs an action, KORVA's money, the global search, notes and payment accounts. */
@ApiTags('platform')
@Public()
@UseGuards(PlatformAdminGuard)
@Controller('platform')
export class PlatformInsightsController {
  constructor(private readonly insights: PlatformInsightsService) {}

  @Get('todo')
  todo() {
    return this.insights.todo();
  }

  @Get('finance')
  finance(
    @Query(new ZodValidationPipe(platformFinanceQuerySchema))
    query: PlatformFinanceQuery,
  ) {
    return this.insights.finance(query.days);
  }

  @Get('search')
  search(@Query('q') q?: string) {
    return this.insights.search(q ?? '');
  }

  @Get('payment-accounts')
  paymentAccounts() {
    return this.insights.paymentAccounts();
  }

  @Get('organizations/:id/notes')
  notes(@Param('id') id: string) {
    return this.insights.notes(id);
  }

  @Post('organizations/:id/notes')
  addNote(
    @Param('id') id: string,
    @CurrentPlatformAdmin() admin: PlatformAdminIdentity,
    @Body(new ZodValidationPipe(createPlatformNoteSchema))
    body: CreatePlatformNoteInput,
  ) {
    return this.insights.addNote(id, admin.email, body.text);
  }
}
