import { UnprocessableEntityException } from '@nestjs/common';
import {
  SASPAY_SANDBOX_BASE_URL,
  SasPayApiError,
  SasPayProvider,
  assertKeyMatchesHost,
  countryOfNumber,
  mapSasPaySessionStatus,
  parseSasPayCredential,
  sasPayPayoutRoute,
  toSasPayAmount,
} from './saspay-payment.provider';

const TEST_KEY = 'sk_test_AbCdEf012345';
const LIVE_KEY = 'sk_live_AbCdEf012345';

function reply(status: number, body: unknown) {
  return { ok: status < 400, status, json: () => Promise.resolve(body) };
}

type FetchMock = jest.Mock<Promise<unknown>, [string, RequestInit]>;

function fetchSequence(...replies: ReturnType<typeof reply>[]) {
  const mock = jest.fn<Promise<unknown>, [string, RequestInit]>();
  for (const r of replies) mock.mockResolvedValueOnce(r);
  return mock as unknown as typeof fetch & FetchMock;
}

function callOf(mock: FetchMock, index = 0): [string, RequestInit] {
  const call = mock.mock.calls[index];
  if (!call) throw new Error(`fetch was not called ${index + 1} time(s)`);
  return call;
}

function body(mock: FetchMock, call = 0): Record<string, unknown> {
  return JSON.parse(callOf(mock, call)[1].body as string) as Record<
    string,
    unknown
  >;
}

describe('SasPay credential and host', () => {
  it('reads one sk_ key, plain or JSON', () => {
    expect(parseSasPayCredential(` ${TEST_KEY} `)).toBe(TEST_KEY);
    expect(parseSasPayCredential(`{"apiKey":"${LIVE_KEY}"}`)).toBe(LIVE_KEY);
    expect(() => parseSasPayCredential('pk_live_x')).toThrow(SasPayApiError);
  });

  it('never sends a test key to production, nor a live key anywhere else', () => {
    // sk_test_ on api.saspay.me moves REAL money (SasPay support, 2026-11).
    expect(() =>
      assertKeyMatchesHost(TEST_KEY, 'https://api.saspay.me/api/v1'),
    ).toThrow(/REAL money/);
    expect(() =>
      assertKeyMatchesHost(LIVE_KEY, SASPAY_SANDBOX_BASE_URL),
    ).toThrow(SasPayApiError);
    expect(() =>
      assertKeyMatchesHost(LIVE_KEY, 'http://localhost:4100'),
    ).toThrow(SasPayApiError);
    expect(() =>
      assertKeyMatchesHost(LIVE_KEY, 'https://api.saspay.me/api/v1'),
    ).not.toThrow();
    expect(() =>
      assertKeyMatchesHost(TEST_KEY, SASPAY_SANDBOX_BASE_URL),
    ).not.toThrow();
  });

  it('picks the host that matches the key', () => {
    const previous = process.env.SASPAY_API_BASE_URL;
    delete process.env.SASPAY_API_BASE_URL;
    const fetchMock = fetchSequence(reply(200, { success: true, data: {} }));
    void new SasPayProvider(TEST_KEY, fetchMock).testConnection();
    expect(callOf(fetchMock, 0)[0]).toBe(
      `${SASPAY_SANDBOX_BASE_URL}/merchant-balances/`,
    );
    process.env.SASPAY_API_BASE_URL = previous;
  });
});

describe('SasPay helpers', () => {
  it('writes amounts as decimal strings, whole for XOF', () => {
    expect(toSasPayAmount(2500.4, 'XOF')).toBe('2500.00');
    expect(toSasPayAmount(12.345, 'USD')).toBe('12.35');
  });

  it('keeps a payment open while the session is, even after a failed attempt', () => {
    expect(mapSasPaySessionStatus('PAID', 'SUCCESS')).toBe('completed');
    expect(mapSasPaySessionStatus('PENDING', null)).toBe('pending');
    expect(mapSasPaySessionStatus('PENDING', 'FAILED')).toBe('pending');
    expect(mapSasPaySessionStatus('PENDING', 'PENDING')).toBe('processing');
    expect(mapSasPaySessionStatus('EXPIRED', null)).toBe('failed');
    expect(mapSasPaySessionStatus('CANCELLED', 'FAILED')).toBe('failed');
    expect(() => mapSasPaySessionStatus('WEIRD', null)).toThrow(SasPayApiError);
  });

  it('routes a withdrawal by the number’s country', () => {
    expect(countryOfNumber('+225 07 07 07 07 07')).toBe('CI');
    expect(
      sasPayPayoutRoute({ provider: 'wave', account: '+225 07 07 07 07 07' }),
    ).toEqual({
      country: 'CI',
      method: 'wave_ci',
      currency: 'XOF',
      msisdn: '+2250707070707',
    });
    expect(() =>
      sasPayPayoutRoute({ provider: 'wave', account: '0707070707' }),
    ).toThrow(SasPayApiError);
    expect(() =>
      sasPayPayoutRoute({ provider: 'wave', account: '+229 01 97 00 00 00' }),
    ).toThrow(SasPayApiError);
  });
});

describe('SasPayProvider', () => {
  const sandbox = (mock: typeof fetch) =>
    new SasPayProvider(TEST_KEY, mock, SASPAY_SANDBOX_BASE_URL);

  it('opens a hosted checkout, fees deducted, invoice as metadata', async () => {
    const fetchMock = fetchSequence(
      reply(201, {
        success: true,
        data: {
          id: 'sess-1',
          checkout_url: 'https://sandbox-checkout.saspay.me/checkout/x',
          status: 'PENDING',
        },
      }),
    );
    const result = await sandbox(fetchMock).createPayment({
      amount: 5000,
      currency: 'XOF',
      invoiceId: 'inv-1',
      customerEmail: 'awa@example.com',
      redirectUrl: 'https://shop.example/track',
    });
    expect(result).toEqual({
      providerReference: 'sess-1',
      status: 'pending',
      checkoutUrl: 'https://sandbox-checkout.saspay.me/checkout/x',
    });
    const [url, init] = callOf(fetchMock, 0);
    expect(url).toBe(`${SASPAY_SANDBOX_BASE_URL}/checkout-sessions/`);
    expect(
      (init as { headers: Record<string, string> }).headers.Authorization,
    ).toBe(`Bearer ${TEST_KEY}`);
    expect(body(fetchMock)).toMatchObject({
      amount: '5000.00',
      currency: 'XOF',
      customer_email: 'awa@example.com',
      customer_name: 'awa',
      return_url: 'https://shop.example/track',
      fee_charge_mode: 'DEDUCTED',
      metadata: { korva_invoice_id: 'inv-1' },
    });
  });

  it('still opens a checkout for a counter sale with no e-mail', async () => {
    const fetchMock = fetchSequence(
      reply(201, {
        success: true,
        data: { id: 's', checkout_url: 'https://c' },
      }),
    );
    await sandbox(fetchMock).createPayment({
      amount: 1000,
      currency: 'XOF',
      invoiceId: 'inv-2',
      redirectUrl: 'https://x',
    });
    expect(body(fetchMock)).toMatchObject({ customer_name: 'Client' });
    expect(typeof body(fetchMock).customer_email).toBe('string');
  });

  it('reads a paid session and books what SasPay kept, in its currency', async () => {
    const fetchMock = fetchSequence(
      reply(200, {
        success: true,
        data: {
          status: 'PAID',
          transaction_id: 'tx-1',
          transaction_status: 'SUCCESS',
        },
      }),
      reply(200, {
        success: true,
        data: {
          id: 'tx-1',
          status: 'SUCCESS',
          requested_amount: '8.20',
          net_amount: '7.79',
          currency: 'USD',
        },
      }),
    );
    const result = await sandbox(fetchMock).verifyPayment('sess-1');
    expect(callOf(fetchMock, 0)[0]).toBe(
      `${SASPAY_SANDBOX_BASE_URL}/checkout-sessions/sess-1/status/`,
    );
    expect(callOf(fetchMock, 1)[0]).toBe(
      `${SASPAY_SANDBOX_BASE_URL}/payments/tx-1/verify/`,
    );
    expect(result).toEqual({
      providerReference: 'sess-1',
      status: 'completed',
      providerFee: 0.41,
      providerAmount: 8.2,
      providerCurrency: 'USD',
    });
  });

  it('leaves an unpaid session pending without asking for a transaction', async () => {
    const fetchMock = fetchSequence(
      reply(200, {
        success: true,
        data: { status: 'PENDING', transaction_id: null },
      }),
    );
    expect(await sandbox(fetchMock).getPaymentStatus('sess-1')).toBe('pending');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends a withdrawal once — the payout id is the Idempotency-Key', async () => {
    const fetchMock = fetchSequence(
      reply(201, { success: true, data: { id: 'po-1' } }),
      reply(200, {
        success: true,
        data: {
          id: 'po-1',
          status: 'SUCCESS',
          requested_amount: '10000.00',
          net_amount: '9850.00',
        },
      }),
    );
    const result = await sandbox(fetchMock).createPayout({
      amount: 10000,
      currency: 'XOF',
      reference: 'payout-abc',
      destination: {
        provider: 'orange_money',
        account: '+225 07 00 00 00 00',
        holderName: 'Awa Koné Traoré',
      },
      description: 'Reversement KORVA — Boutique',
    });
    const init = callOf(fetchMock, 0)[1] as {
      headers: Record<string, string>;
    };
    expect(init.headers['Idempotency-Key']).toBe('payout-abc');
    expect(body(fetchMock)).toMatchObject({
      amount: '10000.00',
      currency: 'XOF',
      country: 'CI',
      method: 'orange_ci',
      recipient: { msisdn: '+2250700000000' },
      customer: { first_name: 'Awa', last_name: 'Koné Traoré' },
    });
    expect(result).toEqual({
      providerReference: 'po-1',
      status: 'completed',
      fee: 150,
    });
  });

  it('refuses a withdrawal in a currency the country does not use', async () => {
    await expect(
      sandbox(fetchSequence()).createPayout({
        amount: 10,
        currency: 'EUR',
        reference: 'p',
        destination: {
          provider: 'wave',
          account: '+2250700000000',
          holderName: 'A',
        },
        description: 'x',
      }),
    ).rejects.toThrow(/XOF only/);
  });

  it('reports SasPay’s own error code', async () => {
    const fetchMock = fetchSequence(
      reply(403, {
        success: false,
        error: { code: 'ip_not_whitelisted', message: 'IP non autorisée' },
        code: 403,
      }),
    );
    await expect(sandbox(fetchMock).getPayout('po-1')).rejects.toThrow(
      /ip_not_whitelisted: IP non autorisée/,
    );
  });

  it('marks a network failure as ambiguous, never as a definite failure', async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValue(
        new Error('socket hang up'),
      ) as unknown as typeof fetch;
    await expect(sandbox(fetchMock).getPayout('po-1')).rejects.toMatchObject({
      ambiguous: true,
    });
  });

  it('finds the session a webhook transaction belongs to', async () => {
    const fetchMock = fetchSequence(
      reply(200, {
        success: true,
        data: {
          next: 'more',
          results: [{ id: 'sess-a', transaction: 'tx-a' }],
        },
      }),
      reply(200, {
        success: true,
        data: { next: null, results: [{ id: 'sess-b', transaction: 'tx-b' }] },
      }),
    );
    expect(await sandbox(fetchMock).findSessionIdForTransaction('tx-b')).toBe(
      'sess-b',
    );
  });

  it('has no refund API', async () => {
    await expect(
      sandbox(fetchSequence()).refundPayment('s'),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});
