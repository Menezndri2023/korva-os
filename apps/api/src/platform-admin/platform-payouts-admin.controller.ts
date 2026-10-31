import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  listPayoutsAdminQuerySchema,
  rejectPayoutSchema,
  walletAdjustmentSchema,
  type ListPayoutsAdminQuery,
  type RejectPayoutInput,
  type WalletAdjustmentInput,
} from '@korva/validation';
import { Public } from '../common/decorators/public.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { PlatformAdminGuard } from './platform-admin.guard';
import { WalletService } from '../finance/wallet/wallet.service';

/** The administration's side of the Solde KORVA: money held, withdrawals to approve. */
@ApiTags('platform')
@Public()
@UseGuards(PlatformAdminGuard)
@Controller('platform')
export class PlatformPayoutsAdminController {
  constructor(private readonly wallet: WalletService) {}

  @Get('wallets/overview')
  overview() {
    return this.wallet.overview();
  }

  @Get('payouts')
  payouts(
    @Query(new ZodValidationPipe(listPayoutsAdminQuerySchema))
    query: ListPayoutsAdminQuery,
  ) {
    return this.wallet.adminPayouts(query.status);
  }

  @Post('payouts/:id/approve')
  @HttpCode(200)
  approve(@Param('id') id: string) {
    return this.wallet.approve(id);
  }

  @Post('payouts/:id/reject')
  @HttpCode(200)
  async reject(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rejectPayoutSchema)) body: RejectPayoutInput,
  ) {
    await this.wallet.reject(id, body.reason);
    return { rejected: true };
  }

  @Post('payouts/:id/sync')
  @HttpCode(200)
  async sync(@Param('id') id: string) {
    await this.wallet.syncPayout(id);
    return { synced: true };
  }

  @Get('organizations/:id/wallet')
  organizationWallet(@Param('id') id: string) {
    return this.wallet.summary(id);
  }

  @Post('organizations/:id/wallet/adjustments')
  @HttpCode(200)
  async adjust(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(walletAdjustmentSchema))
    body: WalletAdjustmentInput,
  ) {
    await this.wallet.adjust(id, body.amount, body.note);
    return this.wallet.summary(id);
  }
}
