import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

import { MessagingProviderModule } from './messaging-provider.module';
import {
  MESSAGING_PROVIDER,
  type MessagingProvider,
} from './messaging-provider.interface';
import { LogMessagingProvider } from './log-messaging.provider';

describe('MessagingProviderModule', () => {
  it('binds LogMessagingProvider by default when MESSAGING_PROVIDER is unset', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MessagingProviderModule],
    })
      .overrideProvider(ConfigService)
      .useValue({ get: jest.fn().mockReturnValue(undefined) })
      .compile();

    const provider = moduleRef.get<MessagingProvider>(MESSAGING_PROVIDER);

    expect(provider).toBeInstanceOf(LogMessagingProvider);
  });

  it('falls back to LogMessagingProvider for an unrecognized/unimplemented provider key ("360dialog")', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MessagingProviderModule],
    })
      .overrideProvider(ConfigService)
      .useValue({
        get: jest
          .fn()
          .mockImplementation((key: string) =>
            key === 'MESSAGING_PROVIDER' ? '360dialog' : undefined,
          ),
      })
      .compile();

    const provider = moduleRef.get<MessagingProvider>(MESSAGING_PROVIDER);

    // No real 360dialog adapter exists in Stage 1 — the factory must never pretend to deliver
    // via an unimplemented adapter, so it still falls back to the log-only default.
    expect(provider).toBeInstanceOf(LogMessagingProvider);
  });
});
