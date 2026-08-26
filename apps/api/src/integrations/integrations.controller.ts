import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  connectMessagingAccountSchema,
  connectPaymentPayoutSchema,
  type ConnectMessagingAccountInput,
  type ConnectPaymentPayoutInput,
} from '@korva/validation';
import type {
  IntegrationSummary,
  TenantContext,
  TestConnectionResult,
} from '@korva/types';
import { IntegrationsService } from './integrations.service';
import type { IntegrationAccountRecord } from './integrations.types';
import { PaymentProviderResolverService } from '../finance/payments/providers/payment-provider-resolver.service';
import { MessagingProviderResolverService } from '../communication/providers/messaging-provider-resolver.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';

/** Never expose anything beyond `IntegrationSummary`'s own fields — see that type's doc comment
 *  in packages/types/src/integrations.ts for why this shape structurally cannot leak a secret. */
function toIntegrationSummary(
  account: IntegrationAccountRecord,
): IntegrationSummary {
  return {
    id: account.id,
    domain: account.domain,
    provider: account.provider,
    status: account.status,
    market: account.market,
    lastVerifiedAt: account.lastVerifiedAt
      ? account.lastVerifiedAt.toISOString()
      : null,
    lastErrorAt: account.lastErrorAt ? account.lastErrorAt.toISOString() : null,
    lastErrorMessage: account.lastErrorMessage,
  };
}

/**
 * Tenant-facing controller for the Settings → Integrations page (Wave 4 Stage 2). Same permission
 * bar as `ApiKeysController`/team management (`settings.manage`, gated on every route below) and
 * the same `@CurrentTenant()`/`ZodValidationPipe` shape. Every response is the secret-free
 * `IntegrationSummary`/`TestConnectionResult` contract from `packages/types/src/integrations.ts`
 * — never a raw Mongoose document, never `secretEncrypted`.
 *
 * Not yet registered in `integrations.module.ts`/`app.module.ts` — the Wave 4 orchestrator wires
 * this controller (and the `PaymentProviderResolverService`/`MessagingProviderResolverService`
 * providers it depends on) in at convergence, exactly like every other Stage 1/2 module in this
 * codebase (see docs/architecture/integrations-platform.md §11.2 item 3).
 */
@ApiTags('organizations')
@Controller('organizations/me/integrations')
export class IntegrationsController {
  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly paymentProviderResolver: PaymentProviderResolverService,
    private readonly messagingProviderResolver: MessagingProviderResolverService,
  ) {}

  @RequirePermissions('settings.manage')
  @Get()
  async list(
    @CurrentTenant() tenant: TenantContext,
  ): Promise<IntegrationSummary[]> {
    const accounts = await this.integrationsService.listTenantAccounts(
      tenant.organizationId,
      tenant.permissions,
    );
    return accounts.map(toIntegrationSummary);
  }

  /**
   * Resolves the tenant's commerce-flow (Flow B, Merchant-of-Record) `PaymentProvider` and asks
   * it to register a payout destination for the submitted bank/mobile-money details. If the
   * resolved provider doesn't implement `createPayoutDestination` (e.g. no real adapter wired up
   * yet), this returns a typed `PAYOUT_CONNECTION_NOT_SUPPORTED` error rather than persisting a
   * row that pretends a connection succeeded — per the "no fake completeness" mandate.
   */
  @RequirePermissions('settings.manage')
  @Post('payment/connect')
  async connectPayment(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(connectPaymentPayoutSchema))
    body: ConnectPaymentPayoutInput,
  ): Promise<IntegrationSummary> {
    const provider = await this.paymentProviderResolver.resolve({
      flow: 'commerce',
      organizationId: tenant.organizationId,
    });

    if (!provider.createPayoutDestination) {
      throw new UnprocessableEntityException({
        code: 'PAYOUT_CONNECTION_NOT_SUPPORTED',
        message: `Payment provider "${provider.name}" does not support connecting a payout destination`,
      });
    }

    const { destinationRef } = await provider.createPayoutDestination({
      organizationId: tenant.organizationId,
      payoutDetails: body.payoutDetails,
    });

    const account = await this.integrationsService.createTenantAccount(
      tenant.organizationId,
      tenant.permissions,
      {
        domain: 'payment',
        provider: provider.name,
        metadata: { destinationRef },
      },
    );

    return toIntegrationSummary(account);
  }

  /**
   * No external call is made here — the tenant already completed 360dialog's own onboarding
   * outside this app (a fully automated Embedded Signup handshake is explicitly not Stage 2
   * scope, per docs/architecture/integrations-platform.md §9). This just persists the submitted
   * WABA details as a new tenant-scope `pending` `IntegrationAccount`.
   */
  @RequirePermissions('settings.manage')
  @Post('messaging/connect')
  async connectMessaging(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(connectMessagingAccountSchema))
    body: ConnectMessagingAccountInput,
  ): Promise<IntegrationSummary> {
    const account = await this.integrationsService.createTenantAccount(
      tenant.organizationId,
      tenant.permissions,
      {
        domain: 'messaging',
        provider: '360dialog',
        metadata: {
          wabaId: body.wabaId,
          phoneNumberId: body.phoneNumberId,
          displayName: body.displayName,
        },
      },
    );

    return toIntegrationSummary(account);
  }

  /**
   * Looks up the account tenant-scoped (rejects cross-org access with a 404, via
   * `IntegrationsService.getTenantAccount`'s own `requireOwnTenantAccount` guard), then resolves
   * the matching platform-level provider for the account's domain and calls its
   * `testConnection()`.
   *
   * Payment domain: `PaymentProviderResolverService.resolve()` returns a real, tenant-scoped
   * `PaymentProvider` instance, so this can call `.testConnection?.()` directly and persist the
   * result via `IntegrationsService.recordTenantAccountTestConnection`.
   *
   * Messaging domain — Stage 2 gap, deliberately not papered over: `MessagingProviderResolverService`
   * (a file this lot doesn't own) currently only exposes `assertTenantConnected()`, a boolean-style
   * connectivity check — there is no method that returns a concrete `MessagingProvider` *instance*
   * scoped to this tenant/provider the way the payment resolver does. Without an instance there is
   * nothing to call `.testConnection()` on. Rather than inventing a new resolver method inside a
   * file owned by a different Stage 2 lot, this calls `assertTenantConnected` (so a genuinely
   * disconnected WABA still fails with the existing typed `WHATSAPP_NOT_CONNECTED` error) and then
   * surfaces the missing-instance situation as `TEST_CONNECTION_NOT_SUPPORTED` — an honest gap, not
   * a faked `{ ok: true }`. See this lot's final report for the same note.
   */
  @RequirePermissions('settings.manage')
  @Post(':id/test-connection')
  async testConnection(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
  ): Promise<TestConnectionResult> {
    const account = await this.integrationsService.getTenantAccount(
      tenant.organizationId,
      tenant.permissions,
      id,
    );

    if (account.domain === 'payment') {
      const provider = await this.paymentProviderResolver.resolve({
        flow: 'commerce',
        organizationId: tenant.organizationId,
      });

      if (!provider.testConnection) {
        throw new UnprocessableEntityException({
          code: 'TEST_CONNECTION_NOT_SUPPORTED',
          message: `Payment provider "${provider.name}" does not support connection testing`,
        });
      }

      const result = await provider.testConnection();
      await this.integrationsService.recordTenantAccountTestConnection(
        tenant.organizationId,
        tenant.permissions,
        id,
        result,
      );
      return result;
    }

    // account.domain === 'messaging' — see this method's doc comment above for the Stage 2 gap.
    await this.messagingProviderResolver.assertTenantConnected({
      organizationId: tenant.organizationId,
      provider: account.provider,
    });

    throw new UnprocessableEntityException({
      code: 'TEST_CONNECTION_NOT_SUPPORTED',
      message: `No per-tenant provider instance can be resolved for messaging provider "${account.provider}" yet (Stage 2 gap — see docs/architecture/integrations-platform.md)`,
    });
  }

  @RequirePermissions('settings.manage')
  @Delete(':id')
  async revoke(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
  ): Promise<IntegrationSummary> {
    const account = await this.integrationsService.revokeTenantAccount(
      tenant.organizationId,
      tenant.permissions,
      id,
    );
    return toIntegrationSummary(account);
  }
}
