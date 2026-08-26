import { LogMessagingProvider } from './log-messaging.provider';

describe('LogMessagingProvider', () => {
  it('send() resolves with a generated providerReference and status "sent"', async () => {
    const provider = new LogMessagingProvider();

    const result = await provider.send({ to: '+15550000000', body: 'hi' });

    expect(result.status).toBe('sent');
    expect(result.providerReference).toMatch(/^log_[0-9a-f]{24}$/);
  });

  it('sendTemplate() resolves with a generated providerReference and status "sent"', async () => {
    const provider = new LogMessagingProvider();

    const result = await provider.sendTemplate({
      to: '+15550000000',
      templateName: 'order_confirmation',
      params: { orderId: '123' },
      category: 'utility',
    });

    expect(result.status).toBe('sent');
    expect(result.providerReference).toMatch(/^log_[0-9a-f]{24}$/);
  });

  it('sendTemplate() logs the template name, category, and params', async () => {
    const provider = new LogMessagingProvider();
    const loggerSpy = jest
      .spyOn(
        (provider as unknown as { logger: { log: (msg: string) => void } })
          .logger,
        'log',
      )
      .mockImplementation(() => undefined);

    await provider.sendTemplate({
      to: '+15550000000',
      templateName: 'order_confirmation',
      params: { orderId: '123' },
      category: 'utility',
    });

    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining('order_confirmation'),
    );
    expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining('utility'));
  });
});
