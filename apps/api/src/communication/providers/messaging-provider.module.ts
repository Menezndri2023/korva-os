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
 * Stage 2 (`MSG-360DIALOG`) fills in the real branch Stage 1 left as a documented placeholder:
 * when `MESSAGING_PROVIDER=360dialog` and `WHATSAPP_API_KEY` is configured, this factory
 * constructs the real `ThreeSixtyDialogProvider` adapter (`three-sixty-dialog.provider.ts`);
 * every other combination — including `'360dialog'` selected with no API key configured — falls
 * back to the unchanged default `LogMessagingProvider`, matching the Wave 4 "no fake completeness"
 * mandate: we never *pretend* to deliver a WhatsApp message via a misconfigured adapter. The
 * string `'360dialog'` appears only in this factory and its adapter file — never in any domain
 * code (`ConversationsService`, `CommunicationModule`, etc.).
 *
 * This module is standalone: it is not yet imported by `CommunicationModule`, which still binds
 * `MESSAGING_PROVIDER` directly via `useClass: LogMessagingProvider`. Rewiring `CommunicationModule`
 * to import this module instead is explicitly out of this lot's scope (see the Stage 2 task's file
 * ownership boundaries) — the Wave 4 orchestrator wires that convergence step in, exactly the same
 * deferral Stage 1 already recorded for `IntegrationsModule`/`IntegrationWebhookModule`.
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
