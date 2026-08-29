import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import {
  MESSAGING_PROVIDER,
  type MessagingProvider,
} from './messaging-provider.interface';
import { LogMessagingProvider } from './log-messaging.provider';
import { ThreeSixtyDialogProvider } from './three-sixty-dialog.provider';

/**
 * Mirrors `apps/api/src/shared/email/email.module.ts`'s `useFactory` pattern exactly, per
 * docs/architecture/integrations-platform.md §5: "`MESSAGING_PROVIDER` binding moves to a
 * `useFactory` in a new `MessagingProviderModule`... `360dialog` is never imported or referenced
 * by name outside this one factory and its adapter file."
 *
 * Stage 2 (`MSG-360DIALOG`) filled in the real branch Stage 1 left as a documented placeholder:
 * when `MESSAGING_PROVIDER=360dialog` and `WHATSAPP_API_KEY` is configured, this factory
 * constructs the real `ThreeSixtyDialogProvider` adapter (`three-sixty-dialog.provider.ts`);
 * every other combination — including `'360dialog'` selected with no API key configured — falls
 * back to the unchanged default `LogMessagingProvider`, matching the Wave 4 "no fake completeness"
 * mandate: we never *pretend* to deliver a WhatsApp message via a misconfigured adapter.
 *
 * STAGE 2.4 UPDATE — this is now a DEV/TEST-only binding, not the production WhatsApp path.
 * `ConversationsService` (and the AI `send_whatsapp` tool through it) no longer injects the
 * `MESSAGING_PROVIDER` token this factory provides at all — every real, tenant-scoped WhatsApp
 * send resolves through `MessagingProviderResolverService.resolveTenantProvider`, which decrypts
 * each tenant's OWN `IntegrationAccount` credential and fails closed if none exists, per
 * docs/architecture/integrations-platform.md's Stage 2.4 addendum. `'360dialog'` DOES now appear
 * as a literal in `ConversationsService` (as the one currently-registered messaging provider
 * key it asks the tenant resolver for) — the guarantee that changed is narrower than before: no
 * *credential* or *adapter construction* happens outside `MessagingProviderRegistry` and this
 * factory, not that the string never appears in domain code. `CommunicationModule` still imports
 * this module and binds `MESSAGING_PROVIDER` through it, so the token remains available for a
 * future non-tenant/system-level use case — but setting `MESSAGING_PROVIDER=360dialog` +
 * `WHATSAPP_API_KEY` no longer activates anything in the real send path; it only affects this
 * otherwise-unused DI token.
 */
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: MESSAGING_PROVIDER,
      useFactory: (configService: ConfigService): MessagingProvider => {
        const providerKey = configService.get<string>('MESSAGING_PROVIDER');
        const apiKey = configService.get<string>('WHATSAPP_API_KEY');
        if (providerKey === '360dialog' && apiKey) {
          return new ThreeSixtyDialogProvider(apiKey);
        }
        return new LogMessagingProvider();
      },
      inject: [ConfigService],
    },
  ],
  exports: [MESSAGING_PROVIDER],
})
export class MessagingProviderModule {}
