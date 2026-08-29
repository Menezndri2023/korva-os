import { Injectable, Logger } from '@nestjs/common';
import type { SystemEvent } from '@korva/types';
import { EventBusService } from '../../core/events/event-bus.service';
import { IntegrationWebhookRepository } from './integration-webhook.repository';
import type { IntegrationWebhookEventDomain } from './schemas/integration-webhook-event.schema';
import type { WebhookVerifier } from './webhook-verifier.interface';

/**
 * BullMQ job-routing value threaded into EventBusService.publish() when this generic Stage 1
 * pipeline has no resolved tenant for a webhook (input.organizationId omitted). publish()
 * requires a non-empty string, but a provider-agnostic ingestion event genuinely may not know its
 * tenant yet — mapping a provider's own account/subaccount id to a KORVA organizationId requires
 * an `IntegrationAccount` lookup, which is Stage 2 territory (see
 * docs/architecture/integrations-platform.md §2/§8), out of scope for this foundation lot.
 * Deliberately distinct from any real ObjectId string so a future per-tenant consumer can detect
 * and skip/reject an unresolved-tenant job instead of silently treating it as belonging to a real
 * organization. The structured log line below still reports the honest value (`null`) regardless
 * of what's threaded into EventBusService for queueing purposes.
 */
const UNRESOLVED_ORGANIZATION_ID = 'unresolved';

const DOMAIN_TO_SYSTEM_EVENT: Record<
  IntegrationWebhookEventDomain,
  SystemEvent
> = {
  payment: 'payment.webhook_received',
  messaging: 'whatsapp.status_updated',
};

export interface ProcessWebhookInput {
  provider: string;
  domain: IntegrationWebhookEventDomain;
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
  verifier: WebhookVerifier;
  /**
   * Provider-specific: pulls this delivery's own event id out of the (already
   * signature-verified, already JSON-parsed) payload — e.g. Flutterwave's `data.id`, 360dialog's
   * own message/status id. Each real Stage 2 adapter supplies its own; there is no
   * cross-provider convention to hardcode here since payload shapes are provider-specific by
   * nature (see docs/architecture/integrations-platform.md §6). A thrown error (missing/malformed
   * field) propagates uncaught — this service has no HTTP context of its own (Stage 1 ships no
   * public controller, see integration-webhook.module.ts), so mapping that to an HTTP 400 is the
   * future real controller's job, exactly like resend-webhook.controller.ts's own INVALID_JSON
   * handling for its pipeline.
   */
  extractEventId: (payload: Record<string, unknown>) => string;
  /**
   * Set by the caller (the real webhook controller) once it has already resolved which tenant
   * this webhook belongs to — Flutterwave: via the KORVA-created Payment matching the webhook's
   * own `tx_ref`; 360dialog: via the tenant IntegrationAccount matching the webhook's own WABA id
   * (see flutterwave-webhook.controller.ts / three-sixty-dialog-webhook.controller.ts, Stage 2.5).
   * Both controllers resolve this from a payload that has ALREADY passed `verifier.verify()`
   * themselves before ever calling `process()` — tenant identity is never derived from anything
   * unverified, and this pipeline's own internal `verifier.verify()` call below still runs
   * regardless, so attribution is never treated as proof of a webhook's validity. Omitted (or
   * `undefined`) means the caller could not resolve a tenant — persisted as an explicit `null` on
   * the IntegrationWebhookEvent document (see that schema's own doc comment) rather than guessed.
   * See UNRESOLVED_ORGANIZATION_ID for how EventBusService.publish() (which always requires a
   * string) is called when this is absent.
   */
  organizationId?: string;
}

export type ProcessWebhookResult = {
  status: 'processed' | 'duplicate' | 'invalid_signature';
};

/**
 * Generic, provider-agnostic webhook ingestion pipeline — generalizes the already-working
 * Resend email pipeline (resend-webhook.controller.ts / resend-webhook.service.ts) so a real
 * Flutterwave/360dialog adapter (Stage 2) doesn't reinvent verify/idempotency/publish. See
 * docs/architecture/integrations-platform.md §6.
 *
 * Steps, in order, matching that document exactly:
 *   (a) verifier.verify() — false fails closed: nothing is persisted, nothing is published.
 *   (b) extract the provider's own event id from the parsed payload (extractEventId).
 *   (c) atomically insert-if-not-exists into IntegrationWebhookEvent (the unique index on
 *       (provider, providerEventId) is what actually arbitrates concurrent/duplicate delivery —
 *       see IntegrationWebhookRepository.claimIfNew's own comment).
 *   (d) only the delivery that WON that insert publishes a SystemEvent via EventBusService — a
 *       duplicate delivery returns 'duplicate' and publishes nothing, ever.
 *   (e) one structured log line per call, fields only — never the raw payload/headers (could
 *       carry provider secrets or customer PII).
 */
@Injectable()
export class IntegrationWebhookService {
  private readonly logger = new Logger(IntegrationWebhookService.name);

  constructor(
    private readonly repository: IntegrationWebhookRepository,
    private readonly eventBus: EventBusService,
  ) {}

  async process(input: ProcessWebhookInput): Promise<ProcessWebhookResult> {
    const startedAt = Date.now();
    const {
      provider,
      domain,
      rawBody,
      headers,
      verifier,
      extractEventId,
      organizationId,
    } = input;
    const eventType = DOMAIN_TO_SYSTEM_EVENT[domain];
    const loggedOrganizationId = organizationId ?? null;

    if (!verifier.verify(rawBody, headers)) {
      this.logResult({
        provider,
        organizationId: loggedOrganizationId,
        eventType,
        eventId: null,
        status: 'invalid_signature',
        durationMs: Date.now() - startedAt,
      });
      return { status: 'invalid_signature' };
    }

    const payload = JSON.parse(rawBody.toString('utf8')) as Record<
      string,
      unknown
    >;
    const eventId = extractEventId(payload);

    const { inserted } = await this.repository.claimIfNew({
      provider,
      providerEventId: eventId,
      domain,
      payload,
      organizationId: organizationId ?? null,
    });

    if (!inserted) {
      // Someone else (a concurrent or earlier redelivered call) already claimed this exact
      // (provider, providerEventId) — the core idempotency guarantee: no second publish, ever.
      this.logResult({
        provider,
        organizationId: loggedOrganizationId,
        eventType,
        eventId,
        status: 'duplicate',
        durationMs: Date.now() - startedAt,
      });
      return { status: 'duplicate' };
    }

    const entityIdField = domain === 'payment' ? 'paymentId' : 'messageId';
    await this.eventBus.publish(
      organizationId ?? UNRESOLVED_ORGANIZATION_ID,
      eventType,
      {
        provider,
        domain,
        providerEventId: eventId,
        [entityIdField]: eventId,
        payload,
      },
    );

    this.logResult({
      provider,
      organizationId: loggedOrganizationId,
      eventType,
      eventId,
      status: 'processed',
      durationMs: Date.now() - startedAt,
    });
    return { status: 'processed' };
  }

  /**
   * Exactly the fields the Wave 4 mandate requires, nothing else — deliberately never passed the
   * raw payload or headers (could carry provider secrets or customer PII).
   */
  private logResult(fields: {
    provider: string;
    organizationId: string | null;
    eventType: SystemEvent;
    eventId: string | null;
    status: ProcessWebhookResult['status'];
    durationMs: number;
  }): void {
    this.logger.log({
      integration: 'webhook',
      provider: fields.provider,
      organizationId: fields.organizationId,
      eventType: fields.eventType,
      eventId: fields.eventId,
      status: fields.status,
      durationMs: fields.durationMs,
    });
  }
}
