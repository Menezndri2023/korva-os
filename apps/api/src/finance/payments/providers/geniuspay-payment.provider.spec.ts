import { UnprocessableEntityException } from '@nestjs/common';
import {
  GeniusPayApiError,
  GeniusPayProvider,
  mapGeniusPayStatus,
  parseGeniusPayCredential,
} from './geniuspay-payment.provider';

const KEYS = 'pk_sandbox_abc sk_sandbox_def';

function respond(status: number, body: unknown) {
  return jest.fn().mockResolvedValue({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  }) as unknown as typeof fetch & jest.Mock;
}

describe('parseGeniusPayCredential', () => {
  it('reads "pk_… sk_…" or JSON', () => {
    expect(parseGeniusPayCredential(KEYS)).toEqual({
      apiKey: 'pk_sandbox_abc',
      apiSecret: 'sk_sandbox_def',
    });
    expect(
      parseGeniusPayCredential(
        '{"apiKey":"pk_live_1","apiSecret":"sk_live_2"}',
      ),
    ).toEqual({ apiKey: 'pk_live_1', apiSecret: 'sk_live_2' });
  });

  it('refuses a missing key or a sandbox/live mix', () => {
    expect(() => parseGeniusPayCredential('pk_live_1')).toThrow(
      GeniusPayApiError,
    );
    expect(() => parseGeniusPayCredential('pk_live_1 sk_sandbox_2')).toThrow(
      GeniusPayApiError,
    );
  });
});

describe('GeniusPayProvider', () => {
  it('opens a hosted checkout with both keys, the amount in whole XOF and the invoice as metadata', async () => {
    const fetchMock = respond(201, {
      success: true,
      data: {
        reference: 'MTX-A1B2C3D4E5',
        status: 'pending',
        checkout_url: 'https://pay.genius.ci/checkout/MTX-A1B2C3D4E5',
      },
    });
    const provider = new GeniusPayProvider(
      KEYS,
      fetchMock,
      'https://gp.test/api/v1/merchant',
    );
    const result = await provider.createPayment({
      amount: 24900,
      currency: 'XOF',
      invoiceId: 'inv-1',
      customerEmail: 'owner@shop.ci',
      redirectUrl: 'https://app.korvasuite.com/dashboard/settings#abonnement',
    });
    expect(result).toEqual({
      providerReference: 'MTX-A1B2C3D4E5',
      status: 'pending',
      checkoutUrl: 'https://pay.genius.ci/checkout/MTX-A1B2C3D4E5',
    });
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      { headers: Record<string, string>; body: string },
    ];
    expect(url).toBe('https://gp.test/api/v1/merchant/payments');
    expect(init.headers['X-API-Key']).toBe('pk_sandbox_abc');
    expect(init.headers['X-API-Secret']).toBe('sk_sandbox_def');
    expect(JSON.parse(init.body)).toEqual({
      amount: 24900,
      currency: 'XOF',
      description: 'KORVA inv-1',
      customer: { email: 'owner@shop.ci' },
      success_url: 'https://app.korvasuite.com/dashboard/settings#abonnement',
      error_url: 'https://app.korvasuite.com/dashboard/settings#abonnement',
      metadata: { korva_invoice_id: 'inv-1' },
    });
  });

  it('reads the status from GeniusPay', async () => {
    const provider = new GeniusPayProvider(
      KEYS,
      respond(200, {
        success: true,
        data: { reference: 'MTX-1', status: 'completed' },
      }),
    );
    await expect(provider.verifyPayment('MTX-1')).resolves.toEqual({
      providerReference: 'MTX-1',
      status: 'completed',
    });
  });

  it('maps every documented status', () => {
    expect(mapGeniusPayStatus('pending')).toBe('pending');
    expect(mapGeniusPayStatus('processing')).toBe('processing');
    expect(mapGeniusPayStatus('completed')).toBe('completed');
    for (const status of ['failed', 'cancelled', 'expired'])
      expect(mapGeniusPayStatus(status)).toBe('failed');
    expect(mapGeniusPayStatus('refunded')).toBe('refunded');
    expect(() => mapGeniusPayStatus('mystery')).toThrow(GeniusPayApiError);
  });

  it('marks a request that got no answer as ambiguous, never as failed', async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValue(
        new Error('socket hang up'),
      ) as unknown as typeof fetch;
    const provider = new GeniusPayProvider(KEYS, fetchMock);
    await expect(provider.verifyPayment('MTX-1')).rejects.toMatchObject({
      ambiguous: true,
    });
  });

  it('refuses a refund with a typed error, since GeniusPay has no refund API', async () => {
    const provider = new GeniusPayProvider(KEYS, respond(200, {}));
    await expect(provider.refundPayment('MTX-1')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('tests the keys against the account endpoint', async () => {
    await expect(
      new GeniusPayProvider(
        KEYS,
        respond(200, { success: true, data: {} }),
      ).testConnection(),
    ).resolves.toEqual({ ok: true });
    await expect(
      new GeniusPayProvider(
        KEYS,
        respond(401, { success: false, message: 'Invalid key' }),
      ).testConnection(),
    ).resolves.toMatchObject({ ok: false });
  });
});
