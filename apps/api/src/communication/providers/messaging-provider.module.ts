import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import {
  MESSAGING_PROVIDER,
  type MessagingProvider,
} from './messaging-provider.interface';
import { LogMessagingProvider } from './log-messaging.provider';

/**
 * Mirrors `apps/api/src/shared/email/email.module.ts`'s `useFactory` pattern exactly, per
 * docs/architecture/integrations-platform.md §5: "`MESSAGING_PROVIDER` binding moves to a
 * `useFactory` in a new `MessagingProviderModule`... `360dialog` is never imported or referenced
 * by name outside this one factory and its adapter file."
 *
 * Stage 1 has no real 360dialog (or any other) adapter yet — that is explicitly Stage 2 (see
 * docs/architecture/integrations-platform.md §8, `MSG-360DIALOG`). So this factory recognizes the
 * `'360dialog'` config value as a *placeholder* for where the real adapter will be constructed
 * once it exists, but since it does not exist in this worktree, every provider value — including
 * `'360dialog'` — currently falls back to the unchanged default `LogMessagingProvider`. The
 * string `'360dialog'` appears only in this comment and, when Stage 2 lands, in the `if` branch
 * below — never in any domain code (`ConversationsService`, `CommunicationModule`, etc.).
 *
 * This module is standalone in Stage 1: it is not yet imported by `CommunicationModule`, which
 * still binds `MESSAGING_PROVIDER` directly via `useClass: LogMessagingProvider`. Rewiring
 * `CommunicationModule` to import this module instead is Stage 2/later, not this task.
 */
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: MESSAGING_PROVIDER,
      useFactory: (configService: ConfigService): MessagingProvider => {
        const providerKey = configService.get<string>('MESSAGING_PROVIDER');
        // Stage 2: `if (providerKey === '360dialog') { return new ThreeSixtyDialogProvider(...); }`
        // No real adapter exists yet for any provider key, so every value — recognized or not —
        // falls back to the log-only default, matching the Wave 4 "no fake completeness" mandate:
        // we never *pretend* to deliver a WhatsApp message via an unimplemented adapter.
        void providerKey;
        return new LogMessagingProvider();
      },
      inject: [ConfigService],
    },
  ],
  exports: [MESSAGING_PROVIDER],
})
export class MessagingProviderModule {}
