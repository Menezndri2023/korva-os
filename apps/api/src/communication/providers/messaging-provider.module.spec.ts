import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { MessagingProviderModule } from './messaging-provider.module';
import {
  MESSAGING_PROVIDER,
  type MessagingProvider,
} from './messaging-provider.interface';
import { LogMessagingProvider } from './log-messaging.provider';
import { ThreeSixtyDialogProvider } from './three-sixty-dialog.provider';

async function resolveProvider(config: Record<string, string | undefined>) {
  const moduleRef = await Test.createTestingModule({
    imports: [MessagingProviderModule],
  })
    .overrideProvider(ConfigService)
    .useValue({
      get: jest.fn().mockImplementation((key: string) => config[key]),
    })
    .compile();

  return moduleRef.get<MessagingProvider>(MESSAGING_PROVIDER);
}

describe('MessagingProviderModule', () => {
  it('binds LogMessagingProvider by default when MESSAGING_PROVIDER is unset', async () => {
    const provider = await resolveProvider({});
    expect(provider).toBeInstanceOf(LogMessagingProvider);
  });

  it('falls back to LogMessagingProvider when MESSAGING_PROVIDER="360dialog" but WHATSAPP_API_KEY is not configured (no fake completeness)', async () => {
    const provider = await resolveProvider({ MESSAGING_PROVIDER: '360dialog' });
    expect(provider).toBeInstanceOf(LogMessagingProvider);
  });

  it('falls back to LogMessagingProvider when WHATSAPP_API_KEY is set but MESSAGING_PROVIDER is not "360dialog"', async () => {
    const provider = await resolveProvider({ WHATSAPP_API_KEY: 'key_123' });
    expect(provider).toBeInstanceOf(LogMessagingProvider);
  });

  it('constructs a real ThreeSixtyDialogProvider when MESSAGING_PROVIDER="360dialog" and WHATSAPP_API_KEY is configured', async () => {
    const provider = await resolveProvider({
      MESSAGING_PROVIDER: '360dialog',
      WHATSAPP_API_KEY: 'key_123',
    });

    expect(provider).toBeInstanceOf(ThreeSixtyDialogProvider);
    expect(provider.name).toBe('360dialog');
  });
});
