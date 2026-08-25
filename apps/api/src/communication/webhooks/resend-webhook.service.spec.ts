import { Test } from '@nestjs/testing';
import { ResendWebhookService } from './resend-webhook.service';
import { MessagesRepository } from '../conversations/messages.repository';

describe('ResendWebhookService', () => {
  let service: ResendWebhookService;
  let messagesRepository: jest.Mocked<
    Pick<MessagesRepository, 'updateStatusByProviderReference'>
  >;

  beforeEach(async () => {
    messagesRepository = {
      updateStatusByProviderReference: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ResendWebhookService,
        { provide: MessagesRepository, useValue: messagesRepository },
      ],
    }).compile();

    service = moduleRef.get(ResendWebhookService);
  });

  it('TEST 1 — email.delivered updates the matching message to "delivered"', async () => {
    messagesRepository.updateStatusByProviderReference.mockResolvedValue({
      _id: 'msg-1',
    } as never);

    const result = await service.handleEvent({
      type: 'email.delivered',
      data: { email_id: 'resend-abc' },
    });

    expect(result).toEqual({ handled: true });
    expect(
      messagesRepository.updateStatusByProviderReference,
    ).toHaveBeenCalledWith('resend-abc', 'delivered');
  });

  it('TEST 2 — email.bounced updates the matching message to "bounced"', async () => {
    messagesRepository.updateStatusByProviderReference.mockResolvedValue({
      _id: 'msg-2',
    } as never);

    await service.handleEvent({
      type: 'email.bounced',
      data: { email_id: 'resend-def' },
    });

    expect(
      messagesRepository.updateStatusByProviderReference,
    ).toHaveBeenCalledWith('resend-def', 'bounced');
  });

  it('TEST 3 — email.complained updates the matching message to "complained"', async () => {
    messagesRepository.updateStatusByProviderReference.mockResolvedValue({
      _id: 'msg-3',
    } as never);

    await service.handleEvent({
      type: 'email.complained',
      data: { email_id: 'resend-ghi' },
    });

    expect(
      messagesRepository.updateStatusByProviderReference,
    ).toHaveBeenCalledWith('resend-ghi', 'complained');
  });

  it('TEST 4 — an unhandled event type (e.g. email.opened) is acknowledged but does not touch any message', async () => {
    const result = await service.handleEvent({
      type: 'email.opened',
      data: { email_id: 'resend-jkl' },
    });

    expect(result).toEqual({ handled: false });
    expect(
      messagesRepository.updateStatusByProviderReference,
    ).not.toHaveBeenCalled();
  });

  it('TEST 5 — an event for an email_id this app never sent is acknowledged, not thrown', async () => {
    messagesRepository.updateStatusByProviderReference.mockResolvedValue(null);

    const result = await service.handleEvent({
      type: 'email.delivered',
      data: { email_id: 'unknown-email-id' },
    });

    expect(result).toEqual({ handled: false });
  });

  it('TEST 6 — a malformed payload (missing data.email_id) is rejected without throwing', async () => {
    const result = await service.handleEvent({ type: 'email.delivered' });

    expect(result).toEqual({ handled: false });
    expect(
      messagesRepository.updateStatusByProviderReference,
    ).not.toHaveBeenCalled();
  });
});
