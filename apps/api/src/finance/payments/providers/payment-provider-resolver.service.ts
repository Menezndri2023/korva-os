import {
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';

import {
  INTEGRATION_ACCOUNTS_READER,
  type IntegrationAccountsReader,
} from '../../../integrations/integrations.types';
import { IntegrationsService } from '../../../integrations/integrations.service';
import { OrganizationsService } from '../../../organizations/organizations.service';
import type { PaymentProvider } from './payment-provider.interface';
import { PaymentProviderRegistry } from './payment-provider.registry';

export type PaymentResolutionFlow = 'subscription' | 'commerce';

export interface ResolvePaymentProviderInput {
  flow: PaymentResolutionFlow;
  organizationId: string;
}

/**
 * Replaces the single `useClass: ManualPaymentProvider` binding with per-request resolution, per
 * docs/architecture/integrations-platform.md §4:
 *
 * - `flow: 'subscription'` (Flow A, KORVA's own SaaS billing) looks up the single
 *   market-independent `platform`-scope `IntegrationAccount(domain: 'payment',
 *   role: 'subscription-billing', market: null)` — Flow A's geography is KORVA's own
 *   incorporation (Morocco), not the tenant's, so no organization lookup is needed.
 * - `flow: 'commerce'` (Flow B, Merchant-of-Record) reads the tenant `Organization.country` and
 *   uses it as `market` when looking up `IntegrationAccount(domain: 'payment',
 *   role: 'merchant-of-record', market: <country>)`.
 *
 * If no active platform account is configured for the requested (role, market), this throws a
 * typed `PAYMENT_PROVIDER_NOT_CONFIGURED` error rather than silently falling back to
 * `ManualPaymentProvider` — per the Wave 4 mandate, no fake completeness. `status !== 'active'`
 * counts as not configured, which is why `create-platform-integration-account.js` needs
 * `--activate`: a created-but-inactive account behaves exactly like a missing one.
 *
 * NO LONGER STANDALONE. This comment said the resolver was "explicitly out of scope for Stage 1"
 * and "exercised only by its own unit tests" until 2026-10-18, by which point it had been wired
 * into eight real call sites — storefront checkout (PublicService), KORVA's own plan billing and
 * auto-charge (SubscriptionBillingService, SubscriptionAutoChargeSchedulerService),
 * PaymentsService and the integrations controller's connectivity checks. A stale "this is inert"
 * note on a live payment path is worse than no note: it invites the next reader to assume
 * nothing here can take money.
 */
@Injectable()
export class PaymentProviderResolverService {
  constructor(
    @Inject(INTEGRATION_ACCOUNTS_READER)
    private readonly integrationAccountsReader: IntegrationAccountsReader,
    private readonly organizationsService: OrganizationsService,
    private readonly registry: PaymentProviderRegistry,
    private readonly integrationsService: IntegrationsService,
  ) {}

  async resolve(input: ResolvePaymentProviderInput): Promise<PaymentProvider> {
    const { flow, organizationId } = input;

    const role =
      flow === 'subscription' ? 'subscription-billing' : 'merchant-of-record';

    let market: string | null = null;
    if (flow === 'commerce') {
      const organization =
        await this.organizationsService.getById(organizationId);
      market = organization.country;
    }

    const account = await this.integrationAccountsReader.findPlatformAccount({
      domain: 'payment',
      role,
      market,
    });

    if (!account || account.status !== 'active') {
      throw new UnprocessableEntityException({
        code: 'PAYMENT_PROVIDER_NOT_CONFIGURED',
        message:
          market === null
            ? `No active payment provider is configured for role "${role}"`
            : `No active payment provider is configured for role "${role}" and market "${market}"`,
      });
    }

    // Stage 2.2: `account` comes from IntegrationAccountsReader, which is deliberately
    // secret-free (see IntegrationAccountRecord's own doc comment) — the decrypted secret can
    // only be obtained through IntegrationsService's own narrow, audited decrypt path, never
    // read off `account` directly. `null` here means the platform account genuinely has no
    // secret stored yet; PaymentProviderRegistry decides per-provider whether that's acceptable
    // (it isn't, for 'flutterwave' — see requireSecret in payment-provider.registry.ts).
    const secret = await this.integrationsService.getDecryptedPlatformSecret(
      account.id,
    );

    return this.registry.resolve(account.provider, secret);
  }
}
