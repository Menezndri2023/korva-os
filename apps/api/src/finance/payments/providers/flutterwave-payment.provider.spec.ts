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

  // Stage 2.2: independent, constructor-level fail-closed guard — must hold even if a future
  // caller bypasses PaymentProviderRegistry's own requireSecret() check and constructs this
  // class directly.
  describe('constructor — fail-closed on a missing secret', () => {
    it('throws when constructed with an empty string', () => {
      expect(() => new FlutterwaveProvider('')).toThrow(FlutterwaveApiError);
    });

    it('never leaves fetch reachable with an empty Authorization header', () => {
      expect(() => new FlutterwaveProvider('')).toThrow();
      expect(fetchSpy).not.toHaveBeenCalled();
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
      expect(result.checkoutUrl).toBe(
        'https://checkout.flutterwave.com/v3/hosted/pay/abc',
      );

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

    it('TEST (Stage 2.6) — network error/timeout is marked `ambiguous: true` (no HTTP response was ever received — Flutterwave may have genuinely processed this); a definite non-2xx response is NOT marked ambiguous', async () => {
      fetchSpy.mockRejectedValue(new Error('The operation was aborted'));
      const provider = new FlutterwaveProvider(SECRET_KEY);

      let networkError: FlutterwaveApiError | undefined;
      try {
        await provider.createPayment(baseInput);
      } catch (error) {
        networkError = error as FlutterwaveApiError;
      }
      expect(networkError?.ambiguous).toBe(true);

      fetchSpy.mockResolvedValue(
        mockJsonResponse(400, { status: 'error', message: 'bad request' }),
      );
      let definiteError: FlutterwaveApiError | undefined;
      try {
        await provider.createPayment(baseInput);
      } catch (error) {
        definiteError = error as FlutterwaveApiError;
      }
      expect(definiteError?.ambiguous).toBeUndefined();
    });

    it('TEST (Stage 2.12 / P3) — ambiguous (network) error still carries the tx_ref already generated and sent, via `generatedReference`', async () => {
      fetchSpy.mockRejectedValue(new Error('The operation was aborted'));
      const provider = new FlutterwaveProvider(SECRET_KEY);

      let error: FlutterwaveApiError | undefined;
      try {
        await provider.createPayment(baseInput);
      } catch (caught) {
        error = caught as FlutterwaveApiError;
      }

      expect(error?.ambiguous).toBe(true);
      expect(error?.generatedReference).toMatch(/^korva_inv_123_[0-9a-f]{16}$/);
    });

    it('TEST (Stage 2.12 / P4) — a DEFINITE (non-2xx) error also carries `generatedReference` (evidence attachment is unconditional on error type; only the `ambiguous` flag distinguishes what the reference is allowed to mean)', async () => {
      fetchSpy.mockResolvedValue(
        mockJsonResponse(401, { status: 'error', message: 'Invalid API key' }),
      );
      const provider = new FlutterwaveProvider(SECRET_KEY);

      let error: FlutterwaveApiError | undefined;
      try {
        await provider.createPayment(baseInput);
      } catch (caught) {
        error = caught as FlutterwaveApiError;
      }

      expect(error?.ambiguous).toBeUndefined();
      expect(error?.generatedReference).toMatch(/^korva_inv_123_[0-9a-f]{16}$/);
    });

    it('TEST (Stage 2.12 / P5) — a thrown error that is NOT a FlutterwaveApiError (defensive: request() itself never throws anything else today, but createPayment must not assume) propagates completely unchanged, with no generatedReference attached', async () => {
      const provider = new FlutterwaveProvider(SECRET_KEY);
      const rawError = new TypeError('some unrelated failure');
      jest
        .spyOn(
          provider as unknown as { request: () => Promise<unknown> },
          'request',
        )
        .mockRejectedValue(rawError);

      await expect(provider.createPayment(baseInput)).rejects.toBe(rawError);
    });

    it('TEST (Stage 2.12 / P6) — success path result shape never leaks generatedReference onto a successful result', async () => {
      fetchSpy.mockResolvedValue(
        mockJsonResponse(200, {
          status: 'success',
          data: { link: 'https://checkout.flutterwave.com/v3/hosted/pay/abc' },
        }),
      );
      const provider = new FlutterwaveProvider(SECRET_KEY);
      const result = await provider.createPayment(baseInput);

      expect(Object.keys(result).sort()).toEqual(
        ['checkoutUrl', 'providerReference', 'status'].sort(),
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
        // Stage 2.12 — this fixture's refund response includes `id: 1`, which is now
        // correctly captured as providerRefundId (no flw_ref in this fixture, so that
        // field stays absent — see the R1+R2/R3 tests above for both captured together).
        providerRefundId: '1',
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

    it('TEST (Stage 2.7A) — a localReferenceForReconciliation, when given, is sent as the documented `comments` field; when omitted, the request body carries no comments field at all', async () => {
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
      await provider.refundPayment(
        'korva_inv_123_abcdef',
        5000,
        'local-refund-id-abc123',
      );

      const [, refundInit] = fetchSpy.mock.calls[1] as [string, RequestInit];
      expect(JSON.parse(refundInit.body as string)).toEqual({
        amount: 5000,
        comments: 'local-refund-id-abc123',
      });
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

    it('TEST (Stage 2.12 / R1+R2) — captures both providerRefundId and providerRefundReference when the refund response contains id and flw_ref', async () => {
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
            data: {
              id: 999888,
              flw_ref: 'FLW-REF-abc123',
              amount_refunded: 5000,
              status: 'succeeded',
            },
          }),
        );

      const provider = new FlutterwaveProvider(SECRET_KEY);
      const result = await provider.refundPayment('korva_inv_123_abcdef', 5000);

      expect(result).toEqual({
        providerReference: 'korva_inv_123_abcdef',
        status: 'refunded',
        providerRefundId: '999888',
        providerRefundReference: 'FLW-REF-abc123',
      });
    });

    it('TEST (Stage 2.12 / R3) — when the refund response contains neither id nor flw_ref, neither field is invented and the existing return shape is unchanged', async () => {
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
            data: { amount_refunded: 5000, status: 'succeeded' },
          }),
        );

      const provider = new FlutterwaveProvider(SECRET_KEY);
      const result = await provider.refundPayment('korva_inv_123_abcdef', 5000);

      expect(result).toEqual({
        providerReference: 'korva_inv_123_abcdef',
        status: 'refunded',
      });
      expect(Object.keys(result).sort()).toEqual(
        ['providerReference', 'status'].sort(),
      );
    });

    it('TEST (Stage 2.12 / R3b) — a malformed/wrong-typed id or flw_ref (e.g. an object) is never coerced or invented, only a real string id is still accepted', async () => {
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
            data: {
              id: { nested: 'not-a-valid-id' },
              flw_ref: 42,
              status: 'succeeded',
            },
          }),
        );

      const provider = new FlutterwaveProvider(SECRET_KEY);
      const result = await provider.refundPayment('korva_inv_123_abcdef', 5000);

      expect(result.providerRefundId).toBeUndefined();
      expect(result.providerRefundReference).toBeUndefined();
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
