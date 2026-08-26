import {
  FlutterwaveApiError,
  FlutterwaveProvider,
} from './flutterwave-payment.provider';

/**
 * Per the Wave 4 mandate §13 ("NE PAS appeler le provider réel dans les tests CI"), every test
 * here mocks the global `fetch` — no real network call to Flutterwave is ever made.
 */
describe('FlutterwaveProvider', () => {
  const SECRET_KEY = 'FLWSECK_TEST-fake-secret-key';
  let fetchSpy: jest.SpiedFunction<typeof fetch>;

  function mockJsonResponse(
    status: number,
    body: unknown,
    ok = status >= 200 && status < 300,
  ): Response {
    return {
      ok,
      status,
      json: () => Promise.resolve(body),
    } as unknown as Response;
  }

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  describe('name', () => {
    it('is "flutterwave"', () => {
      expect(new FlutterwaveProvider(SECRET_KEY).name).toBe('flutterwave');
    });
  });

  describe('createPayment', () => {
    const baseInput = {
      amount: 5000,
      currency: 'XOF',
      invoiceId: 'inv_123',
      customerEmail: 'customer@example.com',
      redirectUrl: 'https://korva.example/return',
    };

    it('TEST — success: posts to /v3/payments and returns a pending result with the generated tx_ref', async () => {
      fetchSpy.mockResolvedValue(
        mockJsonResponse(200, {
          status: 'success',
          message: 'Hosted Link',
          data: { link: 'https://checkout.flutterwave.com/v3/hosted/pay/abc' },
        }),
      );

      const provider = new FlutterwaveProvider(SECRET_KEY);
      const result = await provider.createPayment(baseInput);

      expect(result.status).toBe('pending');
      expect(result.providerReference).toMatch(/^korva_inv_123_[0-9a-f]{16}$/);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.flutterwave.com/v3/payments');
      expect(init.method).toBe('POST');
      expect(init.headers).toMatchObject({
        Authorization: `Bearer ${SECRET_KEY}`,
        'Content-Type': 'application/json',
      });
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body).toMatchObject({
        amount: 5000,
        currency: 'XOF',
        redirect_url: 'https://korva.example/return',
        customer: { email: 'customer@example.com' },
      });
      expect(body.subaccounts).toBeUndefined();
    });

    it('TEST — includes a subaccounts split array when payoutDestination is provided', async () => {
      fetchSpy.mockResolvedValue(
        mockJsonResponse(200, {
          status: 'success',
          data: { link: 'https://checkout.flutterwave.com/v3/hosted/pay/abc' },
        }),
      );

      const provider = new FlutterwaveProvider(SECRET_KEY);
      await provider.createPayment({
        ...baseInput,
        payoutDestination: {
          subaccountId: 'RS_A8EB7D4D9C66C0B1C75014EE67D4D663',
          transactionSplitRatio: 0.5,
        },
      });

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body.subaccounts).toEqual([
        {
          id: 'RS_A8EB7D4D9C66C0B1C75014EE67D4D663',
          transaction_split_ratio: 0.5,
        },
      ]);
    });

    it('TEST — non-2xx response: throws FlutterwaveApiError and never returns a fake reference', async () => {
      fetchSpy.mockResolvedValue(
        mockJsonResponse(401, { status: 'error', message: 'Invalid API key' }),
      );

      const provider = new FlutterwaveProvider(SECRET_KEY);
      await expect(provider.createPayment(baseInput)).rejects.toThrow(
        FlutterwaveApiError,
      );
      await expect(provider.createPayment(baseInput)).rejects.toThrow(
        /Invalid API key/,
      );
    });

    it('TEST — malformed response body (missing data.link): throws FlutterwaveApiError', async () => {
      fetchSpy.mockResolvedValue(
        mockJsonResponse(200, { status: 'success', data: {} }),
      );

      const provider = new FlutterwaveProvider(SECRET_KEY);
      await expect(provider.createPayment(baseInput)).rejects.toThrow(
        FlutterwaveApiError,
      );
    });

    it('TEST — response body missing the top-level status field: throws FlutterwaveApiError', async () => {
      fetchSpy.mockResolvedValue(mockJsonResponse(200, { data: {} }));

      const provider = new FlutterwaveProvider(SECRET_KEY);
      await expect(provider.createPayment(baseInput)).rejects.toThrow(
        FlutterwaveApiError,
      );
    });

    it('TEST — non-JSON response body: throws FlutterwaveApiError', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError('Unexpected token')),
      } as unknown as Response);

      const provider = new FlutterwaveProvider(SECRET_KEY);
      await expect(provider.createPayment(baseInput)).rejects.toThrow(
        FlutterwaveApiError,
      );
    });

    it('TEST — network error/timeout: throws FlutterwaveApiError, not the raw fetch error', async () => {
      fetchSpy.mockRejectedValue(new Error('The operation was aborted'));

      const provider = new FlutterwaveProvider(SECRET_KEY);
      await expect(provider.createPayment(baseInput)).rejects.toThrow(
        FlutterwaveApiError,
      );
      await expect(provider.createPayment(baseInput)).rejects.toThrow(
        /Network error calling Flutterwave/,
      );
    });
  });

  describe('verifyPayment / getPaymentStatus', () => {
    it('TEST — success: calls verify_by_reference and maps "successful" to "completed"', async () => {
      fetchSpy.mockResolvedValue(
        mockJsonResponse(200, {
          status: 'success',
          data: { status: 'successful', amount: 5000, currency: 'XOF' },
        }),
      );

      const provider = new FlutterwaveProvider(SECRET_KEY);
      const result = await provider.verifyPayment('korva_inv_123_abcdef');

      expect(result).toEqual({
        providerReference: 'korva_inv_123_abcdef',
        status: 'completed',
      });
      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        'https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=korva_inv_123_abcdef',
      );
    });

    it('TEST — maps "pending" and "failed" transaction statuses correctly', async () => {
      const provider = new FlutterwaveProvider(SECRET_KEY);

      fetchSpy.mockResolvedValue(
        mockJsonResponse(200, {
          status: 'success',
          data: { status: 'pending' },
        }),
      );
      expect(await provider.getPaymentStatus('ref_1')).toBe('pending');

      fetchSpy.mockResolvedValue(
        mockJsonResponse(200, {
          status: 'success',
          data: { status: 'failed' },
        }),
      );
      expect(await provider.getPaymentStatus('ref_1')).toBe('failed');
    });

    it('TEST — unrecognized transaction status: throws FlutterwaveApiError', async () => {
      fetchSpy.mockResolvedValue(
        mockJsonResponse(200, {
          status: 'success',
          data: { status: 'something-new-and-unknown' },
        }),
      );

      const provider = new FlutterwaveProvider(SECRET_KEY);
      await expect(provider.verifyPayment('ref_1')).rejects.toThrow(
        FlutterwaveApiError,
      );
    });

    it('TEST — non-2xx response: throws FlutterwaveApiError', async () => {
      fetchSpy.mockResolvedValue(
        mockJsonResponse(404, { status: 'error', message: 'No transaction' }),
      );

      const provider = new FlutterwaveProvider(SECRET_KEY);
      await expect(provider.verifyPayment('ref_1')).rejects.toThrow(
        FlutterwaveApiError,
      );
    });

    it('TEST — malformed body (missing data.status): throws FlutterwaveApiError', async () => {
      fetchSpy.mockResolvedValue(
        mockJsonResponse(200, { status: 'success', data: {} }),
      );

      const provider = new FlutterwaveProvider(SECRET_KEY);
      await expect(provider.verifyPayment('ref_1')).rejects.toThrow(
        FlutterwaveApiError,
      );
    });

    it('TEST — network timeout: throws FlutterwaveApiError', async () => {
      fetchSpy.mockRejectedValue(new DOMException('Aborted', 'AbortError'));

      const provider = new FlutterwaveProvider(SECRET_KEY);
      await expect(provider.verifyPayment('ref_1')).rejects.toThrow(
        FlutterwaveApiError,
      );
    });
  });

  describe('refundPayment', () => {
    it('TEST — success: resolves the numeric id via verify_by_reference, then posts the refund', async () => {
      fetchSpy
        .mockResolvedValueOnce(
          mockJsonResponse(200, {
            status: 'success',
            data: { id: 285959875, status: 'successful' },
          }),
        )
        .mockResolvedValueOnce(
          mockJsonResponse(200, {
            status: 'success',
            data: { id: 1, amount_refunded: 5000, status: 'succeeded' },
          }),
        );

      const provider = new FlutterwaveProvider(SECRET_KEY);
      const result = await provider.refundPayment('korva_inv_123_abcdef', 5000);

      expect(result).toEqual({
        providerReference: 'korva_inv_123_abcdef',
        status: 'refunded',
      });

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      const [verifyUrl] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(verifyUrl).toContain('/transactions/verify_by_reference?tx_ref=');
      const [refundUrl, refundInit] = fetchSpy.mock.calls[1] as [
        string,
        RequestInit,
      ];
      expect(refundUrl).toBe(
        'https://api.flutterwave.com/v3/transactions/285959875/refund',
      );
      expect(JSON.parse(refundInit.body as string)).toEqual({ amount: 5000 });
    });

    it('TEST — verify step fails to resolve an id: throws FlutterwaveApiError without attempting the refund call', async () => {
      fetchSpy.mockResolvedValue(
        mockJsonResponse(200, { status: 'success', data: {} }),
      );

      const provider = new FlutterwaveProvider(SECRET_KEY);
      await expect(
        provider.refundPayment('korva_inv_123_abcdef', 5000),
      ).rejects.toThrow(FlutterwaveApiError);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('TEST — refund call itself fails (non-2xx): throws FlutterwaveApiError', async () => {
      fetchSpy
        .mockResolvedValueOnce(
          mockJsonResponse(200, {
            status: 'success',
            data: { id: 285959875, status: 'successful' },
          }),
        )
        .mockResolvedValueOnce(
          mockJsonResponse(400, {
            status: 'error',
            message: 'Refund amount exceeds transaction amount',
          }),
        );

      const provider = new FlutterwaveProvider(SECRET_KEY);
      await expect(
        provider.refundPayment('korva_inv_123_abcdef', 999_999),
      ).rejects.toThrow(FlutterwaveApiError);
    });
  });

  describe('createPayoutDestination', () => {
    const validPayoutDetails = {
      account_bank: '044',
      account_number: '0690000031',
      business_name: "Tenant's Storefront",
      country: 'CI',
      split_type: 'percentage',
      split_value: '0.1',
    };

    it('TEST — success: posts to /v3/subaccounts and returns the destinationRef', async () => {
      fetchSpy.mockResolvedValue(
        mockJsonResponse(200, {
          status: 'success',
          data: {
            id: 1,
            subaccount_id: 'RS_A8EB7D4D9C66C0B1C75014EE67D4D663',
            account_number: '0690000031',
            account_bank: '044',
          },
        }),
      );

      const provider = new FlutterwaveProvider(SECRET_KEY);
      const result = await provider.createPayoutDestination({
        organizationId: 'org_1',
        payoutDetails: validPayoutDetails,
      });

      expect(result).toEqual({
        destinationRef: 'RS_A8EB7D4D9C66C0B1C75014EE67D4D663',
      });
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.flutterwave.com/v3/subaccounts');
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body.split_value).toBe(0.1);
      expect(body.account_bank).toBe('044');
    });

    it('TEST — missing a required field: throws FlutterwaveApiError without calling fetch', async () => {
      const provider = new FlutterwaveProvider(SECRET_KEY);
      const incomplete: Record<string, string> = { ...validPayoutDetails };
      delete incomplete.account_bank;

      await expect(
        provider.createPayoutDestination({
          organizationId: 'org_1',
          payoutDetails: incomplete,
        }),
      ).rejects.toThrow(/account_bank/);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('TEST — non-numeric split_value: throws FlutterwaveApiError without calling fetch', async () => {
      const provider = new FlutterwaveProvider(SECRET_KEY);

      await expect(
        provider.createPayoutDestination({
          organizationId: 'org_1',
          payoutDetails: { ...validPayoutDetails, split_value: 'not-a-number' },
        }),
      ).rejects.toThrow(/split_value/);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('TEST — non-2xx response: throws FlutterwaveApiError', async () => {
      fetchSpy.mockResolvedValue(
        mockJsonResponse(400, { status: 'error', message: 'Invalid account' }),
      );

      const provider = new FlutterwaveProvider(SECRET_KEY);
      await expect(
        provider.createPayoutDestination({
          organizationId: 'org_1',
          payoutDetails: validPayoutDetails,
        }),
      ).rejects.toThrow(FlutterwaveApiError);
    });

    it('TEST — malformed response (missing subaccount_id): throws FlutterwaveApiError', async () => {
      fetchSpy.mockResolvedValue(
        mockJsonResponse(200, { status: 'success', data: {} }),
      );

      const provider = new FlutterwaveProvider(SECRET_KEY);
      await expect(
        provider.createPayoutDestination({
          organizationId: 'org_1',
          payoutDetails: validPayoutDetails,
        }),
      ).rejects.toThrow(FlutterwaveApiError);
    });
  });

  describe('testConnection', () => {
    it('TEST — success: calls GET /v3/balances and returns ok: true', async () => {
      fetchSpy.mockResolvedValue(
        mockJsonResponse(200, { status: 'success', data: [] }),
      );

      const provider = new FlutterwaveProvider(SECRET_KEY);
      const result = await provider.testConnection();

      expect(result).toEqual({ ok: true });
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.flutterwave.com/v3/balances');
      expect(init.method).toBe('GET');
    });

    it('TEST — bad credentials (401): returns ok: false with a message, never throws', async () => {
      fetchSpy.mockResolvedValue(
        mockJsonResponse(401, { status: 'error', message: 'Invalid API key' }),
      );

      const provider = new FlutterwaveProvider('bad-key');
      const result = await provider.testConnection();

      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/Invalid API key/);
    });

    it('TEST — network error: returns ok: false, never throws', async () => {
      fetchSpy.mockRejectedValue(new Error('network unreachable'));

      const provider = new FlutterwaveProvider(SECRET_KEY);
      const result = await provider.testConnection();

      expect(result.ok).toBe(false);
      expect(result.message).toBeDefined();
    });
  });
});
