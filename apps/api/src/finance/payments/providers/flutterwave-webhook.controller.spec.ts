import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FlutterwaveWebhookController } from './flutterwave-webhook.controller';
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

describe('FlutterwaveWebhookController', () => {
  const secretHash = 'a-very-secret-hash-value';
  let controller: FlutterwaveWebhookController;
  let configService: { get: jest.Mock };
  let webhookService: { process: jest.Mock };
  let paymentsRepository: {
    findOrganizationIdByProviderReference: jest.Mock;
    findIdByProviderReference: jest.Mock;
  };
  let paymentsService: { reconcileProcessingPayment: jest.Mock };

  beforeEach(() => {
    configService = { get: jest.fn().mockReturnValue(secretHash) };
    webhookService = {
      process: jest.fn().mockResolvedValue({ status: 'processed' }),
    };
    // Unresolved by default — individual tests (F1/F2/F3/F4) override this to prove real
    // attribution/isolation behavior.
    paymentsRepository = {
      findOrganizationIdByProviderReference: jest.fn().mockResolvedValue(null),
      // No matching Payment by default — the Stage 2.6 reconciliation-trigger step becomes a
      // no-op unless a test explicitly wires up a match.
      findIdByProviderReference: jest.fn().mockResolvedValue(null),
    };
    paymentsService = {
      reconcileProcessingPayment: jest.fn().mockResolvedValue(undefined),
    };
    controller = new FlutterwaveWebhookController(
      configService as unknown as ConfigService,
      webhookService as unknown as IntegrationWebhookService,
      paymentsRepository as unknown as PaymentsRepository,
      paymentsService as unknown as PaymentsService,
    );
  });

  function makeRequest(
    body: string,
    headers: Record<string, string | string[] | undefined> = {},
  ) {
    return {
      rawBody: Buffer.from(body, 'utf8'),
      headers: { 'verif-hash': secretHash, ...headers },
    } as never;
  }

  it('TEST 1 — fail-closed: rejects with 503 when FLUTTERWAVE_WEBHOOK_SECRET_HASH is not configured', async () => {
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
      controller.handle(makeRequest('{}', { 'verif-hash': 'wrong-hash' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('TEST 4 — success: calls IntegrationWebhookService.process exactly once with the expected shape and returns { received: true }', async () => {
    const body = JSON.stringify({
      event: 'charge.completed',
      data: { id: 285959875, tx_ref: 'korva_inv_1_abc', status: 'successful' },
    });

    const result = await controller.handle(makeRequest(body));

    expect(result).toEqual({ received: true });
    expect(webhookService.process).toHaveBeenCalledTimes(1);
    const calls = webhookService.process.mock
      .calls as unknown as CapturedProcessCall[][];
    const call = calls[0]![0]!;
    expect(call.provider).toBe('flutterwave');
    expect(call.domain).toBe('payment');
    expect(call.rawBody).toBeInstanceOf(Buffer);
    expect(call.headers['verif-hash']).toBe(secretHash);
    expect(typeof call.extractEventId).toBe('function');
    expect(call.verifier.provider).toBe('flutterwave');
  });

  it('TEST 5 — duplicate delivery: still returns { received: true } (idempotency is the pipeline’s job, not the controller’s)', async () => {
    webhookService.process.mockResolvedValue({ status: 'duplicate' });

    const result = await controller.handle(makeRequest('{}'));

    expect(result).toEqual({ received: true });
  });

  it('TEST 6 — a thrown error from the pipeline (e.g. malformed payload / extractEventId failure) is mapped to 400, not left as 500', async () => {
    webhookService.process.mockRejectedValue(
      new Error(
        'Flutterwave webhook payload is missing both data.id and data.tx_ref',
      ),
    );

    await expect(controller.handle(makeRequest('{}'))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  describe('extractEventId (exercised indirectly via the extractEventId function passed to process())', () => {
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
      expect(extractEventId({ data: { id: 12345, tx_ref: 'ref_1' } })).toBe(
        '12345',
      );
    });

    it('falls back to data.tx_ref when data.id is absent', async () => {
      const extractEventId = await getExtractEventId();
      expect(extractEventId({ data: { tx_ref: 'ref_1' } })).toBe('ref_1');
    });

    it('throws when neither data.id nor data.tx_ref is present', async () => {
      const extractEventId = await getExtractEventId();
      expect(() => extractEventId({ data: {} })).toThrow(
        /missing both data.id and data.tx_ref/,
      );
    });
  });

  describe('Stage 2.5 — webhook tenant attribution (F1–F10)', () => {
    function bodyWithTxRef(
      txRef: string,
      extra: Record<string, unknown> = {},
    ): string {
      return JSON.stringify({
        event: 'charge.completed',
        data: { id: 12345, tx_ref: txRef, status: 'successful', ...extra },
      });
    }

    it('F1 — a valid signed webhook resolves to the correct tenant via PaymentsRepository, looked up by (provider, tx_ref)', async () => {
      paymentsRepository.findOrganizationIdByProviderReference.mockResolvedValue(
        'org-A',
      );

      await controller.handle(makeRequest(bodyWithTxRef('korva_inv_1_abc')));

      expect(
        paymentsRepository.findOrganizationIdByProviderReference,
      ).toHaveBeenCalledWith('flutterwave', 'korva_inv_1_abc');
      const calls = webhookService.process.mock
        .calls as unknown as CapturedProcessCall[][];
      expect(calls[0]![0]!.organizationId).toBe('org-A');
    });

    it('F2 — a valid signed webhook for an unknown/unresolvable tx_ref is passed through with organizationId undefined (unresolved), never rejected outright', async () => {
      paymentsRepository.findOrganizationIdByProviderReference.mockResolvedValue(
        null,
      );

      await controller.handle(makeRequest(bodyWithTxRef('korva_inv_unknown')));

      const calls = webhookService.process.mock
        .calls as unknown as CapturedProcessCall[][];
      expect(calls[0]![0]!.organizationId).toBeUndefined();
    });

    it('F3 — a forged organizationId field in the payload is completely ignored: attribution comes only from PaymentsRepository, never from the payload', async () => {
      paymentsRepository.findOrganizationIdByProviderReference.mockResolvedValue(
        'org-A',
      );

      await controller.handle(
        makeRequest(
          bodyWithTxRef('korva_inv_1_abc', { organizationId: 'org-FORGED' }),
        ),
      );

      const calls = webhookService.process.mock
        .calls as unknown as CapturedProcessCall[][];
      // Resolved strictly from the (provider, tx_ref) lookup — identical to F1's result — the
      // forged field in the payload never reaches the resolved value at all.
      expect(calls[0]![0]!.organizationId).toBe('org-A');
    });

    it('F4 — tenant A / tenant B isolation: two deliveries with different tx_refs resolve to their own, distinct organizationId, never crossed', async () => {
      paymentsRepository.findOrganizationIdByProviderReference.mockImplementation(
        (_provider: string, txRef: string) =>
          Promise.resolve(txRef === 'korva_inv_A_1' ? 'org-A' : 'org-B'),
      );

      await controller.handle(makeRequest(bodyWithTxRef('korva_inv_A_1')));
      await controller.handle(makeRequest(bodyWithTxRef('korva_inv_B_1')));

      const calls = webhookService.process.mock
        .calls as unknown as CapturedProcessCall[][];
      expect(calls[0]![0]!.organizationId).toBe('org-A');
      expect(calls[1]![0]!.organizationId).toBe('org-B');
    });

    it('F6 — an invalid signature never triggers tenant attribution: PaymentsRepository is not even called', async () => {
      await controller.handle(
        makeRequest(bodyWithTxRef('korva_inv_1_abc'), {
          'verif-hash': 'wrong-hash',
        }),
      );

      expect(
        paymentsRepository.findOrganizationIdByProviderReference,
      ).not.toHaveBeenCalled();
    });

    it('F7 — missing webhook config still fails closed with 503 before any attribution attempt is made', async () => {
      configService.get.mockReturnValue(undefined);

      await expect(
        controller.handle(makeRequest(bodyWithTxRef('korva_inv_1_abc'))),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(
        paymentsRepository.findOrganizationIdByProviderReference,
      ).not.toHaveBeenCalled();
    });

    describe('Stage 2.6 — webhook-triggered immediate reconciliation (latency optimization)', () => {
      it('a verified, first-time-seen webhook looks up the Payment by tx_ref and calls PaymentsService.reconcileProcessingPayment', async () => {
        paymentsRepository.findIdByProviderReference.mockResolvedValue({
          id: 'payment-1',
          organizationId: 'org-A',
        });

        await controller.handle(makeRequest(bodyWithTxRef('korva_inv_1_abc')));

        expect(
          paymentsRepository.findIdByProviderReference,
        ).toHaveBeenCalledWith('flutterwave', 'korva_inv_1_abc');
        expect(paymentsService.reconcileProcessingPayment).toHaveBeenCalledWith(
          'org-A',
          'payment-1',
        );
      });

      it('a verified DUPLICATE delivery also triggers reconciliation — a redelivered webhook is just as valid a trigger to check again', async () => {
        webhookService.process.mockResolvedValue({ status: 'duplicate' });
        paymentsRepository.findIdByProviderReference.mockResolvedValue({
          id: 'payment-1',
          organizationId: 'org-A',
        });

        await controller.handle(makeRequest(bodyWithTxRef('korva_inv_1_abc')));

        expect(paymentsService.reconcileProcessingPayment).toHaveBeenCalledWith(
          'org-A',
          'payment-1',
        );
      });

      it('an invalid signature never triggers reconciliation', async () => {
        await controller.handle(
          makeRequest(bodyWithTxRef('korva_inv_1_abc'), {
            'verif-hash': 'wrong-hash',
          }),
        );

        expect(
          paymentsRepository.findIdByProviderReference,
        ).not.toHaveBeenCalled();
        expect(
          paymentsService.reconcileProcessingPayment,
        ).not.toHaveBeenCalled();
      });

      it('no matching Payment yet (webhook arrived before checkout creation finished persisting it) is a silent no-op — still returns { received: true }', async () => {
        paymentsRepository.findIdByProviderReference.mockResolvedValue(null);

        const result = await controller.handle(
          makeRequest(bodyWithTxRef('korva_inv_1_abc')),
        );

        expect(result).toEqual({ received: true });
        expect(
          paymentsService.reconcileProcessingPayment,
        ).not.toHaveBeenCalled();
      });

      it('a failure inside reconciliation is swallowed and never affects the webhook acknowledgment — the periodic sweep remains the safety net', async () => {
        paymentsRepository.findIdByProviderReference.mockResolvedValue({
          id: 'payment-1',
          organizationId: 'org-A',
        });
        paymentsService.reconcileProcessingPayment.mockRejectedValue(
          new Error('Mongo unreachable'),
        );

        const result = await controller.handle(
          makeRequest(bodyWithTxRef('korva_inv_1_abc')),
        );

        expect(result).toEqual({ received: true });
      });
    });
  });
});
