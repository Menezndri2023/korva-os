import {
  PaystackApiError,
  PaystackProvider,
} from './paystack-payment.provider';

/**
 * Same mandate as flutterwave-payment.provider.spec.ts: no real network call to Paystack is ever
 * made — every test mocks the global `fetch`.
 */
describe('PaystackProvider', () => {
  const SECRET_KEY = 'sk_test-fake-secret-key';
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
    it('is "paystack"', () => {
      expect(new PaystackProvider(SECRET_KEY).name).toBe('paystack');
    });
  });

  describe('constructor — fail-closed on a missing secret', () => {
    it('throws when constructed with an empty string', () => {
      expect(() => new PaystackProvider('')).toThrow(PaystackApiError);
    });

    it('never leaves fetch reachable with an empty Authorization header', () => {
      expect(() => new PaystackProvider('')).toThrow();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('createPayment', () => {
    const baseInput = {
      amount: 50,
      currency: 'NGN',
      invoiceId: 'inv_123',
      customerEmail: 'customer@example.com',
      redirectUrl: 'https://korva.example/return',
    };

    it('TEST — success: posts to /transaction/initialize with the amount converted to kobo, returns a pending result with the generated reference', async () => {
      fetchSpy.mockResolvedValue(
        mockJsonResponse(200, {
          status: true,
          message: 'Authorization URL created',
          data: {
            authorization_url: 'https://checkout.paystack.com/abc',
            access_code: 'abc',
            reference: 'ignored',
          },
        }),
      );

      const provider = new PaystackProvider(SECRET_KEY);
      const result = await provider.createPayment(baseInput);

      expect(result.status).toBe('pending');
      expect(result.providerReference).toMatch(/^korva_inv_123_[0-9a-f]{16}$/);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.paystack.co/transaction/initialize');
      expect(init.method).toBe('POST');
      expect(init.headers).toMatchObject({
        Authorization: `Bearer ${SECRET_KEY}`,
        'Content-Type': 'application/json',
      });
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      // 50 (major units) -> 5000 (kobo) — the one detail that genuinely differs from Flutterwave.
      expect(body.amount).toBe(5000);
      expect(body.email).toBe('customer@example.com');
      expect(body.currency).toBe('NGN');
      expect(body.callback_url).toBe('https://korva.example/return');
      expect(body.reference).toBe(result.providerReference);
    });

    it('TEST — non-2xx response: throws PaystackApiError and never returns a fake reference', async () => {
      fetchSpy.mockResolvedValue(
        mockJsonResponse(401, { status: false, message: 'Invalid key' }),
      );

      const provider = new PaystackProvider(SECRET_KEY);
      await expect(provider.createPayment(baseInput)).rejects.toThrow(
        PaystackApiError,
      );
      await expect(provider.createPayment(baseInput)).rejects.toThrow(
        /Invalid key/,
      );
    });

    it('TEST — malformed response body (missing data.authorization_url): throws PaystackApiError', async () => {
      fetchSpy.mockResolvedValue(
        mockJsonResponse(200, { status: true, data: {} }),
      );

      const provider = new PaystackProvider(SECRET_KEY);
      await expect(provider.createPayment(baseInput)).rejects.toThrow(
        PaystackApiError,
      );
    });

    it('TEST — response body missing the top-level status field: throws PaystackApiError', async () => {
      fetchSpy.mockResolvedValue(mockJsonResponse(200, { data: {} }));

      const provider = new PaystackProvider(SECRET_KEY);
      await expect(provider.createPayment(baseInput)).rejects.toThrow(
        PaystackApiError,
      );
    });

    it('TEST — non-JSON response body: throws PaystackApiError', async () => {
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError('Unexpected token')),
      } as unknown as Response);

      const provider = new PaystackProvider(SECRET_KEY);
      await expect(provider.createPayment(baseInput)).rejects.toThrow(
        PaystackApiError,
      );
    });

    it('TEST — network error/timeout: throws PaystackApiError, not the raw fetch error', async () => {
      fetchSpy.mockRejectedValue(new Error('The operation was aborted'));

      const provider = new PaystackProvider(SECRET_KEY);
      await expect(provider.createPayment(baseInput)).rejects.toThrow(
        PaystackApiError,
      );
      await expect(provider.createPayment(baseInput)).rejects.toThrow(
        /Network error calling Paystack/,
      );
    });

    it('TEST — network error/timeout is marked `ambiguous: true`; a definite non-2xx response is NOT marked ambiguous', async () => {
      fetchSpy.mockRejectedValue(new Error('The operation was aborted'));
      const provider = new PaystackProvider(SECRET_KEY);

      let networkError: PaystackApiError | undefined;
      try {
        await provider.createPayment(baseInput);
      } catch (error) {
        networkError = error as PaystackApiError;
      }
      expect(networkError?.ambiguous).toBe(true);

      fetchSpy.mockResolvedValue(
        mockJsonResponse(400, { status: false, message: 'bad request' }),
      );
      let definiteError: PaystackApiError | undefined;
      try {
        await provider.createPayment(baseInput);
      } catch (error) {
        definiteError = error as PaystackApiError;
      }
      expect(definiteError?.ambiguous).toBeUndefined();
    });

    it('TEST — an ambiguous (network) error still carries the reference already generated and sent, via `generatedReference`', async () => {
      fetchSpy.mockRejectedValue(new Error('The operation was aborted'));
      const provider = new PaystackProvider(SECRET_KEY);

      let error: PaystackApiError | undefined;
      try {
        await provider.createPayment(baseInput);
      } catch (caught) {
        error = caught as PaystackApiError;
      }

      expect(error?.ambiguous).toBe(true);
      expect(error?.generatedReference).toMatch(/^korva_inv_123_[0-9a-f]{16}$/);
    });

    it('TEST — success path result shape carries providerReference, status, and checkoutUrl', async () => {
      fetchSpy.mockResolvedValue(
        mockJsonResponse(200, {
          status: true,
          data: { authorization_url: 'https://checkout.paystack.com/abc' },
        }),
      );
      const provider = new PaystackProvider(SECRET_KEY);
      const result = await provider.createPayment(baseInput);

      expect(Object.keys(result).sort()).toEqual(
        ['checkoutUrl', 'providerReference', 'status'].sort(),
      );
      expect(result.checkoutUrl).toBe('https://checkout.paystack.com/abc');
    });
  });

  describe('verifyPayment / getPaymentStatus', () => {
    it('TEST — success: calls verify/<reference> and maps "success" to "completed"', async () => {
      fetchSpy.mockResolvedValue(
        mockJsonResponse(200, {
          status: true,
          data: { status: 'success', amount: 5000, currency: 'NGN' },
        }),
      );

      const provider = new PaystackProvider(SECRET_KEY);
      const result = await provider.verifyPayment('korva_inv_123_abcdef');

      expect(result).toEqual({
        providerReference: 'korva_inv_123_abcdef',
        status: 'completed',
      });
      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        'https://api.paystack.co/transaction/verify/korva_inv_123_abcdef',
      );
    });

    it('TEST — maps "failed" and "abandoned" transaction statuses to "failed"', async () => {
      const provider = new PaystackProvider(SECRET_KEY);

      fetchSpy.mockResolvedValue(
        mockJsonResponse(200, { status: true, data: { status: 'failed' } }),
      );
      expect(await provider.getPaymentStatus('ref_1')).toBe('failed');

      fetchSpy.mockResolvedValue(
        mockJsonResponse(200, { status: true, data: { status: 'abandoned' } }),
      );
      expect(await provider.getPaymentStatus('ref_1')).toBe('failed');
    });

    it('TEST — unrecognized transaction status: throws PaystackApiError', async () => {
      fetchSpy.mockResolvedValue(
        mockJsonResponse(200, {
          status: true,
          data: { status: 'something-new-and-unknown' },
        }),
      );

      const provider = new PaystackProvider(SECRET_KEY);
      await expect(provider.verifyPayment('ref_1')).rejects.toThrow(
        PaystackApiError,
      );
    });

    it('TEST — non-2xx response: throws PaystackApiError', async () => {
      fetchSpy.mockResolvedValue(
        mockJsonResponse(404, {
          status: false,
          message: 'Transaction not found',
        }),
      );

      const provider = new PaystackProvider(SECRET_KEY);
      await expect(provider.verifyPayment('ref_1')).rejects.toThrow(
        PaystackApiError,
      );
    });

    it('TEST — malformed body (missing data.status): throws PaystackApiError', async () => {
      fetchSpy.mockResolvedValue(
        mockJsonResponse(200, { status: true, data: {} }),
      );

      const provider = new PaystackProvider(SECRET_KEY);
      await expect(provider.verifyPayment('ref_1')).rejects.toThrow(
        PaystackApiError,
      );
    });

    it('TEST — network timeout: throws PaystackApiError', async () => {
      fetchSpy.mockRejectedValue(new DOMException('Aborted', 'AbortError'));

      const provider = new PaystackProvider(SECRET_KEY);
      await expect(provider.verifyPayment('ref_1')).rejects.toThrow(
        PaystackApiError,
      );
    });
  });

  describe('refundPayment', () => {
    it('TEST — success: posts directly to /refund (no separate id-resolution call, unlike Flutterwave) with the amount converted to minor units', async () => {
      fetchSpy.mockResolvedValue(
        mockJsonResponse(200, {
          status: true,
          message: 'Refund has been queued for processing',
          data: {
            id: 999888,
            transaction: 'korva_inv_123_abcdef',
            reference: 'rf_abc',
          },
        }),
      );

      const provider = new PaystackProvider(SECRET_KEY);
      const result = await provider.refundPayment('korva_inv_123_abcdef', 50);

      expect(result).toEqual({
        providerReference: 'korva_inv_123_abcdef',
        status: 'refunded',
        providerRefundId: '999888',
        providerRefundReference: 'rf_abc',
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.paystack.co/refund');
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body).toEqual({
        transaction: 'korva_inv_123_abcdef',
        amount: 5000,
      });
    });

    it('TEST — a localReferenceForReconciliation, when given, is sent as `merchant_note`; when omitted, the request body carries no merchant_note field at all', async () => {
      fetchSpy.mockResolvedValue(
        mockJsonResponse(200, { status: true, data: { id: 1 } }),
      );

      const provider = new PaystackProvider(SECRET_KEY);
      await provider.refundPayment(
        'korva_inv_123_abcdef',
        50,
        'local-refund-id-abc123',
      );

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(init.body as string)).toEqual({
        transaction: 'korva_inv_123_abcdef',
        amount: 5000,
        merchant_note: 'local-refund-id-abc123',
      });
    });

    it('TEST — when the refund response contains neither id nor reference, neither field is invented', async () => {
      fetchSpy.mockResolvedValue(
        mockJsonResponse(200, { status: true, data: {} }),
      );

      const provider = new PaystackProvider(SECRET_KEY);
      const result = await provider.refundPayment('korva_inv_123_abcdef', 50);

      expect(result).toEqual({
        providerReference: 'korva_inv_123_abcdef',
        status: 'refunded',
      });
      expect(Object.keys(result).sort()).toEqual(
        ['providerReference', 'status'].sort(),
      );
    });

    it('TEST — refund call fails (non-2xx): throws PaystackApiError', async () => {
      fetchSpy.mockResolvedValue(
        mockJsonResponse(400, {
          status: false,
          message: 'Refund amount exceeds transaction amount',
        }),
      );

      const provider = new PaystackProvider(SECRET_KEY);
      await expect(
        provider.refundPayment('korva_inv_123_abcdef', 999_999),
      ).rejects.toThrow(PaystackApiError);
    });
  });

  describe('testConnection', () => {
    it('TEST — success: calls GET /balance and returns ok: true', async () => {
      fetchSpy.mockResolvedValue(
        mockJsonResponse(200, { status: true, data: [] }),
      );

      const provider = new PaystackProvider(SECRET_KEY);
      const result = await provider.testConnection();

      expect(result).toEqual({ ok: true });
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.paystack.co/balance');
      expect(init.method).toBe('GET');
    });

    it('TEST — bad credentials (401): returns ok: false with a message, never throws', async () => {
      fetchSpy.mockResolvedValue(
        mockJsonResponse(401, { status: false, message: 'Invalid key' }),
      );

      const provider = new PaystackProvider('sk_bad-key');
      const result = await provider.testConnection();

      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/Invalid key/);
    });

    it('TEST — network error: returns ok: false, never throws', async () => {
      fetchSpy.mockRejectedValue(new Error('network unreachable'));

      const provider = new PaystackProvider(SECRET_KEY);
      const result = await provider.testConnection();

      expect(result.ok).toBe(false);
      expect(result.message).toBeDefined();
    });
  });

  describe('mandate capture on verify', () => {
    it('captures a reusable authorization_code as mandateReference', async () => {
      fetchSpy.mockResolvedValue(
        mockJsonResponse(200, {
          status: true,
          data: {
            status: 'success',
            authorization: {
              authorization_code: 'AUTH_abc123',
              reusable: true,
            },
          },
        }),
      );

      const result = await new PaystackProvider(SECRET_KEY).verifyPayment(
        'korva_inv_123_abc',
      );

      expect(result.status).toBe('completed');
      expect(result.mandateReference).toBe('AUTH_abc123');
    });

    it('ignores a non-reusable authorization', async () => {
      // Paystack sets reusable:false for channels that cannot be charged again without the
      // payer. Replaying one would fail on every renewal while KORVA believed it had
      // card-on-file billing.
      fetchSpy.mockResolvedValue(
        mockJsonResponse(200, {
          status: true,
          data: {
            status: 'success',
            authorization: {
              authorization_code: 'AUTH_abc123',
              reusable: false,
            },
          },
        }),
      );

      const result = await new PaystackProvider(SECRET_KEY).verifyPayment(
        'korva_inv_123_abc',
      );

      expect(result.mandateReference).toBeUndefined();
    });

    it('leaves mandateReference undefined when the response carries no authorization at all', async () => {
      fetchSpy.mockResolvedValue(
        mockJsonResponse(200, { status: true, data: { status: 'success' } }),
      );

      const result = await new PaystackProvider(SECRET_KEY).verifyPayment(
        'korva_inv_123_abc',
      );

      expect(result.status).toBe('completed');
      expect('mandateReference' in result).toBe(false);
    });
  });

  describe('chargeRecurring', () => {
    const input = {
      mandateReference: 'AUTH_abc123',
      amount: 29,
      currency: 'NGN',
      reference: 'korva_auto_ABO-0001',
      customerEmail: 'owner@korva.test',
    };

    it('posts the authorization to charge_authorization in minor units', async () => {
      fetchSpy.mockResolvedValue(
        mockJsonResponse(200, { status: true, data: { status: 'success' } }),
      );

      const result = await new PaystackProvider(SECRET_KEY).chargeRecurring(
        input,
      );

      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/transaction/charge_authorization');
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body.authorization_code).toBe('AUTH_abc123');
      expect(body.email).toBe('owner@korva.test');
      expect(body.amount).toBe(2900);
      expect(body.reference).toBe('korva_auto_ABO-0001');
      // Final, unlike createPayment: there is no redirect left to wait on.
      expect(result.status).toBe('completed');
      expect(result.providerReference).toBe('korva_auto_ABO-0001');
    });

    it('reports a declined card as a provider-confirmed failure, not an exception', async () => {
      fetchSpy.mockResolvedValue(
        mockJsonResponse(200, { status: true, data: { status: 'failed' } }),
      );

      const result = await new PaystackProvider(SECRET_KEY).chargeRecurring(
        input,
      );

      expect(result.status).toBe('failed');
    });

    it('re-attaches the reference to a network failure so it is never lost', async () => {
      fetchSpy.mockRejectedValue(new Error('socket hang up'));

      await expect(
        new PaystackProvider(SECRET_KEY).chargeRecurring(input),
      ).rejects.toMatchObject({
        // Ambiguous: no response ever arrived, so the charge may have gone through. The caller
        // must never treat this as 'failed' — see isAmbiguousProviderError.
        ambiguous: true,
        generatedReference: 'korva_auto_ABO-0001',
      });
    });
  });
});
