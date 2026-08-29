import { createHmac } from 'node:crypto';
import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaystackWebhookController } from './paystack-webhook.controller';
import { IntegrationWebhookService } from '../../../integrations/webhooks/integration-webhook.service';
import { PaymentsRepository } from '../payments.repository';
import { PaymentsService } from '../payments.service';

interface CapturedProcessCall {
  provider: string;
  domain: string;
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
  verifier: { provider: string };
  extractEventId: (payload: Record<string, unknown>) => string;
  organizationId?: string;
}

describe('PaystackWebhookController', () => {
  const secretKey = 'sk_test-a-very-secret-key';
  let controller: PaystackWebhookController;
  let configService: { get: jest.Mock };
  let webhookService: { process: jest.Mock };
  let paymentsRepository: {
    findOrganizationIdByProviderReference: jest.Mock;
    findIdByProviderReference: jest.Mock;
  };
  let paymentsService: { reconcileProcessingPayment: jest.Mock };

  beforeEach(() => {
    configService = { get: jest.fn().mockReturnValue(secretKey) };
    webhookService = {
      process: jest.fn().mockResolvedValue({ status: 'processed' }),
    };
    paymentsRepository = {
      findOrganizationIdByProviderReference: jest.fn().mockResolvedValue(null),
      findIdByProviderReference: jest.fn().mockResolvedValue(null),
    };
    paymentsService = {
      reconcileProcessingPayment: jest.fn().mockResolvedValue(undefined),
    };
    controller = new PaystackWebhookController(
      configService as unknown as ConfigService,
      webhookService as unknown as IntegrationWebhookService,
      paymentsRepository as unknown as PaymentsRepository,
      paymentsService as unknown as PaymentsService,
    );
  });

  /** Unlike Flutterwave's static-secret echo, Paystack's scheme is a genuine HMAC over the raw
   *  body — this computes the real signature a caller with a valid webhook signature would send,
   *  so these tests exercise the actual verification logic rather than faking a pass. */
  function realSignature(body: string): string {
    return createHmac('sha512', secretKey).update(body).digest('hex');
  }

  function makeRequest(
    body: string,
    headers: Record<string, string | string[] | undefined> = {},
  ) {
    return {
      rawBody: Buffer.from(body, 'utf8'),
      headers: { 'x-paystack-signature': realSignature(body), ...headers },
    } as never;
  }

  it('TEST 1 — fail-closed: rejects with 503 when PAYSTACK_SECRET_KEY is not configured', async () => {
    configService.get.mockReturnValue(undefined);

    await expect(controller.handle(makeRequest('{}'))).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(webhookService.process).not.toHaveBeenCalled();
  });

  it('TEST 2 — fail-closed: rejects with 503 when req.rawBody is unavailable', async () => {
    await expect(
      controller.handle({ headers: {} } as never),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(webhookService.process).not.toHaveBeenCalled();
  });

  it('TEST 3 — 401 on bad signature: when the pipeline reports invalid_signature, throws UnauthorizedException', async () => {
    webhookService.process.mockResolvedValue({ status: 'invalid_signature' });

    await expect(
      controller.handle(
        makeRequest('{}', { 'x-paystack-signature': 'wrong-signature' }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('TEST 4 — success: calls IntegrationWebhookService.process exactly once with the expected shape and returns { received: true }', async () => {
    const body = JSON.stringify({
      event: 'charge.success',
      data: { id: 12345, reference: 'korva_inv_1_abc', status: 'success' },
    });

    const result = await controller.handle(makeRequest(body));

    expect(result).toEqual({ received: true });
    expect(webhookService.process).toHaveBeenCalledTimes(1);
    const calls = webhookService.process.mock
      .calls as unknown as CapturedProcessCall[][];
    const call = calls[0]![0]!;
    expect(call.provider).toBe('paystack');
    expect(call.domain).toBe('payment');
    expect(call.rawBody).toBeInstanceOf(Buffer);
    expect(typeof call.extractEventId).toBe('function');
    expect(call.verifier.provider).toBe('paystack');
  });

  it('TEST 5 — duplicate delivery: still returns { received: true }', async () => {
    webhookService.process.mockResolvedValue({ status: 'duplicate' });

    const result = await controller.handle(makeRequest('{}'));

    expect(result).toEqual({ received: true });
  });

  it('TEST 6 — a thrown error from the pipeline is mapped to 400, not left as 500', async () => {
    webhookService.process.mockRejectedValue(
      new Error(
        'Paystack webhook payload is missing both data.id and data.reference',
      ),
    );

    await expect(controller.handle(makeRequest('{}'))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  describe('extractEventId', () => {
    async function getExtractEventId(): Promise<
      (payload: Record<string, unknown>) => string
    > {
      await controller.handle(makeRequest('{}'));
      const calls = webhookService.process.mock
        .calls as unknown as CapturedProcessCall[][];
      return calls[0]![0]!.extractEventId;
    }

    it('uses data.id when present', async () => {
      const extractEventId = await getExtractEventId();
      expect(extractEventId({ data: { id: 12345, reference: 'ref_1' } })).toBe(
        '12345',
      );
    });

    it('falls back to data.reference when data.id is absent', async () => {
      const extractEventId = await getExtractEventId();
      expect(extractEventId({ data: { reference: 'ref_1' } })).toBe('ref_1');
    });

    it('throws when neither data.id nor data.reference is present', async () => {
      const extractEventId = await getExtractEventId();
      expect(() => extractEventId({ data: {} })).toThrow(
        /missing both data.id and data.reference/,
      );
    });
  });

  describe('webhook tenant attribution', () => {
    function bodyWithReference(
      reference: string,
      extra: Record<string, unknown> = {},
    ): string {
      return JSON.stringify({
        event: 'charge.success',
        data: { id: 12345, reference, status: 'success', ...extra },
      });
    }

    it('resolves to the correct tenant via PaymentsRepository, looked up by (provider, reference)', async () => {
      paymentsRepository.findOrganizationIdByProviderReference.mockResolvedValue(
        'org-A',
      );

      await controller.handle(
        makeRequest(bodyWithReference('korva_inv_1_abc')),
      );

      expect(
        paymentsRepository.findOrganizationIdByProviderReference,
      ).toHaveBeenCalledWith('paystack', 'korva_inv_1_abc');
      const calls = webhookService.process.mock
        .calls as unknown as CapturedProcessCall[][];
      expect(calls[0]![0]!.organizationId).toBe('org-A');
    });

    it('an unknown/unresolvable reference is passed through with organizationId undefined, never rejected outright', async () => {
      paymentsRepository.findOrganizationIdByProviderReference.mockResolvedValue(
        null,
      );

      await controller.handle(
        makeRequest(bodyWithReference('korva_inv_unknown')),
      );

      const calls = webhookService.process.mock
        .calls as unknown as CapturedProcessCall[][];
      expect(calls[0]![0]!.organizationId).toBeUndefined();
    });

    it('a forged organizationId field in the payload is completely ignored', async () => {
      paymentsRepository.findOrganizationIdByProviderReference.mockResolvedValue(
        'org-A',
      );

      await controller.handle(
        makeRequest(
          bodyWithReference('korva_inv_1_abc', {
            organizationId: 'org-FORGED',
          }),
        ),
      );

      const calls = webhookService.process.mock
        .calls as unknown as CapturedProcessCall[][];
      expect(calls[0]![0]!.organizationId).toBe('org-A');
    });

    it('tenant A / tenant B isolation: two deliveries with different references resolve to distinct organizationId values', async () => {
      paymentsRepository.findOrganizationIdByProviderReference.mockImplementation(
        (_provider: string, reference: string) =>
          Promise.resolve(reference === 'korva_inv_A_1' ? 'org-A' : 'org-B'),
      );

      await controller.handle(makeRequest(bodyWithReference('korva_inv_A_1')));
      await controller.handle(makeRequest(bodyWithReference('korva_inv_B_1')));

      const calls = webhookService.process.mock
        .calls as unknown as CapturedProcessCall[][];
      expect(calls[0]![0]!.organizationId).toBe('org-A');
      expect(calls[1]![0]!.organizationId).toBe('org-B');
    });

    it('an invalid signature never triggers tenant attribution: PaymentsRepository is not even called', async () => {
      await controller.handle(
        makeRequest(bodyWithReference('korva_inv_1_abc'), {
          'x-paystack-signature': 'wrong-signature',
        }),
      );

      expect(
        paymentsRepository.findOrganizationIdByProviderReference,
      ).not.toHaveBeenCalled();
    });

    it('missing webhook config still fails closed with 503 before any attribution attempt is made', async () => {
      configService.get.mockReturnValue(undefined);

      await expect(
        controller.handle(makeRequest(bodyWithReference('korva_inv_1_abc'))),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(
        paymentsRepository.findOrganizationIdByProviderReference,
      ).not.toHaveBeenCalled();
    });

    describe('webhook-triggered immediate reconciliation', () => {
      it('a verified, first-time-seen webhook looks up the Payment by reference and calls PaymentsService.reconcileProcessingPayment', async () => {
        paymentsRepository.findIdByProviderReference.mockResolvedValue({
          id: 'payment-1',
          organizationId: 'org-A',
        });

        await controller.handle(
          makeRequest(bodyWithReference('korva_inv_1_abc')),
        );

        expect(
          paymentsRepository.findIdByProviderReference,
        ).toHaveBeenCalledWith('paystack', 'korva_inv_1_abc');
        expect(paymentsService.reconcileProcessingPayment).toHaveBeenCalledWith(
          'org-A',
          'payment-1',
        );
      });

      it('a verified DUPLICATE delivery also triggers reconciliation', async () => {
        webhookService.process.mockResolvedValue({ status: 'duplicate' });
        paymentsRepository.findIdByProviderReference.mockResolvedValue({
          id: 'payment-1',
          organizationId: 'org-A',
        });

        await controller.handle(
          makeRequest(bodyWithReference('korva_inv_1_abc')),
        );

        expect(paymentsService.reconcileProcessingPayment).toHaveBeenCalledWith(
          'org-A',
          'payment-1',
        );
      });

      it('an invalid signature never triggers reconciliation', async () => {
        await controller.handle(
          makeRequest(bodyWithReference('korva_inv_1_abc'), {
            'x-paystack-signature': 'wrong-signature',
          }),
        );

        expect(
          paymentsRepository.findIdByProviderReference,
        ).not.toHaveBeenCalled();
        expect(
          paymentsService.reconcileProcessingPayment,
        ).not.toHaveBeenCalled();
      });

      it('no matching Payment yet is a silent no-op — still returns { received: true }', async () => {
        paymentsRepository.findIdByProviderReference.mockResolvedValue(null);

        const result = await controller.handle(
          makeRequest(bodyWithReference('korva_inv_1_abc')),
        );

        expect(result).toEqual({ received: true });
        expect(
          paymentsService.reconcileProcessingPayment,
        ).not.toHaveBeenCalled();
      });

      it('a failure inside reconciliation is swallowed and never affects the webhook acknowledgment', async () => {
        paymentsRepository.findIdByProviderReference.mockResolvedValue({
          id: 'payment-1',
          organizationId: 'org-A',
        });
        paymentsService.reconcileProcessingPayment.mockRejectedValue(
          new Error('Mongo unreachable'),
        );

        const result = await controller.handle(
          makeRequest(bodyWithReference('korva_inv_1_abc')),
        );

        expect(result).toEqual({ received: true });
      });
    });
  });
});
