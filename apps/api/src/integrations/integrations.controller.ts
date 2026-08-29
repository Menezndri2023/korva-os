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
 * Registered in `integrations.module.ts`, wired into `app.module.ts` since Wave 4 Stage 2
 * convergence (see docs/architecture/integrations-platform.md §11.2 item 3).
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
   * scope, per docs/architecture/integrations-platform.md §9). This persists the submitted WABA
   * details AND the D360-API-KEY credential (`body.apiKey`, encrypted at rest by
   * `IntegrationsService.createTenantAccount`) as a new tenant-scope `pending`
   * `IntegrationAccount` — without the secret here, the account could never pass
   * `testConnection` afterward (there is no other route that can attach one after the fact).
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
        secret: body.apiKey,
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
   * Messaging domain — uses `MessagingProviderResolverService.resolveForTest()`, NOT
   * `resolveTenantProvider()`: the latter requires `status === 'active'` (the real-send-path
   * gate), but the entire point of this endpoint is to test a still-`pending` account and let a
   * successful result promote it to `active` (see `recordTenantAccountTestConnection`) — calling
   * `resolveTenantProvider()` here would make a freshly connected account unable to ever pass
   * its first test (a pending account can never resolve, so it can never become active, so it
   * can never resolve...). `resolveForTest` decrypts the tenant's own stored secret directly
   * (still ownership-scoped by `organizationId`) without the `active` precondition; the registry
   * itself still fails closed with `MESSAGING_PROVIDER_CREDENTIAL_MISSING` if no secret was ever
   * stored.
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

    // account.domain === 'messaging' — see this method's doc comment above for why this calls
    // resolveForTest (bootstrap-safe for a pending account), not resolveTenantProvider (the
    // active-only real-send-path resolver).
    const messagingProvider =
      await this.messagingProviderResolver.resolveForTest({
        organizationId: tenant.organizationId,
        accountId: id,
        provider: account.provider,
      });

    if (!messagingProvider.testConnection) {
      throw new UnprocessableEntityException({
        code: 'TEST_CONNECTION_NOT_SUPPORTED',
        message: `Messaging provider "${messagingProvider.name}" does not support connection testing`,
      });
    }

    const result = await messagingProvider.testConnection();
    await this.integrationsService.recordTenantAccountTestConnection(
      tenant.organizationId,
      tenant.permissions,
      id,
      result,
    );
    return result;
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
