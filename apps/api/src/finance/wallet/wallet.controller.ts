import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  confirmPayoutDestinationSchema,
  listWalletQuerySchema,
  requestPayoutSchema,
  setPayoutDestinationSchema,
  updateAutoPayoutSchema,
  updateSubscriptionAutopaySchema,
  type ConfirmPayoutDestinationInput,
  type ListWalletQuery,
  type RequestPayoutInput,
  type SetPayoutDestinationInput,
  type UpdateAutoPayoutInput,
  type UpdateSubscriptionAutopayInput,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthenticatedUser } from '../../core/tenant/request-context.types';
import { WalletService } from './wallet.service';

/**
 * The business's Solde KORVA: its online takings, and withdrawals to its mobile money. Money
 * leaving the business: `settings.manage` (owner and admins) for everything here.
 */
@ApiTags('wallet')
@RequirePermissions('settings.manage')
@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get()
  summary(@CurrentTenant() tenant: TenantContext) {
    return this.walletService.summary(tenant.organizationId);
  }

  @Get('entries')
  entries(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listWalletQuerySchema)) query: ListWalletQuery,
  ) {
    return this.walletService.listEntries(
      tenant.organizationId,
      query.page,
      query.limit,
    );
  }

  @Get('payouts')
  payouts(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listWalletQuerySchema)) query: ListWalletQuery,
  ) {
    return this.walletService.listPayouts(
      tenant.organizationId,
      query.page,
      query.limit,
    );
  }

  @Post('payouts')
  requestPayout(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(requestPayoutSchema)) body: RequestPayoutInput,
  ) {
    return this.walletService.requestPayout(
      tenant.organizationId,
      body,
      'manual',
      user.userId,
    );
  }

  /** Step 1: the number is held and a code is e-mailed to the person entering it. */
  @Put('destination')
  setDestination(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(setPayoutDestinationSchema))
    body: SetPayoutDestinationInput,
  ) {
    return this.walletService.setDestination(
      tenant.organizationId,
      user.email,
      body,
    );
  }

  /** Step 2: the code makes it the withdrawal number. */
  @Post('destination/confirm')
  @HttpCode(200)
  async confirmDestination(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(confirmPayoutDestinationSchema))
    body: ConfirmPayoutDestinationInput,
  ) {
    await this.walletService.confirmDestination(
      tenant.organizationId,
      body.code,
    );
    return { confirmed: true };
  }

  @Patch('auto-payout')
  async autoPayout(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(updateAutoPayoutSchema))
    body: UpdateAutoPayoutInput,
  ) {
    await this.walletService.updateAutoPayout(tenant.organizationId, body);
    return this.walletService.summary(tenant.organizationId);
  }

  /** Pay KORVA plan invoices from the balance when it covers them. */
  @Patch('subscription-autopay')
  async subscriptionAutopay(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(updateSubscriptionAutopaySchema))
    body: UpdateSubscriptionAutopayInput,
  ) {
    await this.walletService.updateSubscriptionAutopay(
      tenant.organizationId,
      body.enabled,
    );
    return this.walletService.summary(tenant.organizationId);
  }
}
