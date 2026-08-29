import { Logger } from '@nestjs/common';
import type {
  MessagingProvider,
  MessagingSendResult,
  SendTemplateInput,
} from './messaging-provider.interface';

/**
 * Real WhatsApp Business API adapter via 360dialog — the BSP KORVA has chosen as its first
 * WhatsApp candidate (docs/decisions/whatsapp-provider.md). 360dialog markets itself as a
 * "zero markup" passthrough of Meta's own WhatsApp Cloud API: its gateway mirrors Meta's
 * request/response shapes almost exactly, just fronted by a simple per-channel API key instead of
 * Meta's own OAuth/system-user bearer token + phone-number-id-scoped URL.
 *
 * Verified against 360dialog's and Meta's current public docs while building this Stage 2 lot
 * (2026-08-26) — see the lot report for the full citation list. Key findings baked into this file:
 *   - `POST https://waba-v2.360dialog.io/messages`, header `D360-API-KEY: <key>`
 *     (https://docs.360dialog.com/docs/messaging-api/api-reference/messages.md).
 *   - Request body shape for both a session/text message and a template message matches Meta's
 *     Cloud API `messaging_product`/`type`/`text.body`/`template.{name,language,components}` shape
 *     field-for-field (cross-checked against
 *     https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages).
 *   - Success response: `{ messaging_product, contacts: [{ input, wa_id }], messages: [{ id,
 *     message_status }] }` on both 360dialog's and Meta's docs — `messages[0].id` (a `wamid....`
 *     value) is the provider reference this adapter returns, used for later delivery-status
 *     webhook correlation (mirrors how `ResendEmailProvider` treats Resend's `data.id` today).
 *   - `GET /whatsapp_business_profile?fields=...` (same host/header) is the cheapest real
 *     authenticated call 360dialog documents that proves an API key is live — used for
 *     `testConnection()` below
 *     (https://docs.360dialog.com/docs/resources/phone-numbers/business-profiles.md).
 *
 * Honesty note: no real network call to 360dialog or Meta was made while building this file — no
 * credentials exist in this environment. Every shape above is taken directly from current
 * documentation, not guessed or fabricated; tests mock `fetch` and never touch the real network.
 */
const THREE_SIXTY_DIALOG_BASE_URL = 'https://waba-v2.360dialog.io';

interface ThreeSixtyDialogMessagesResponse {
  messaging_product?: string;
  contacts?: Array<{ input: string; wa_id: string }>;
  messages?: Array<{ id: string; message_status?: string }>;
}

export class ThreeSixtyDialogProvider implements MessagingProvider {
  readonly name = '360dialog';
  private readonly logger = new Logger(ThreeSixtyDialogProvider.name);

  /** Stage 2.4: an independent, constructor-level fail-closed guard mirroring
   *  `FlutterwaveProvider`'s own (Stage 2.2) — must hold even if a future caller bypasses
   *  `MessagingProviderRegistry`'s own `requireSecret` check and constructs this class directly.
   *  This class never reads `process.env`/`ConfigService` itself; the credential is always
   *  handed in by whoever constructs it (the registry, given a tenant's decrypted secret). */
  constructor(private readonly apiKey: string) {
    if (!apiKey) {
      throw new Error(
        'ThreeSixtyDialogProvider requires a non-empty API key — refusing to construct an adapter that would send D360-API-KEY: <empty>',
      );
    }
  }

  send(input: { to: string; body: string }): Promise<MessagingSendResult> {
    return this.postMessage(
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: input.to,
        type: 'text',
        text: { body: input.body, preview_url: false },
      },
      input.to,
    );
  }

  sendTemplate(input: SendTemplateInput): Promise<MessagingSendResult> {
    // `category` is a template-*creation*-time attribute in Meta's model (it governs approval
    // review and pricing) — it is never a per-send field, so it is deliberately not included in
    // the request body, matching Meta's own `template.components` reference shape.
    //
    // `SendTemplateInput.params` carries no language field in Stage 1's interface, so a caller may
    // optionally smuggle one in as `params.language`; everything else in `params` is treated as a
    // positional body-component parameter. Plain JS objects with numeric-looking string keys
    // ("1", "2", ...) are iterated in ascending numeric order regardless of insertion order (a
    // language-level guarantee, not an assumption made here), which conveniently matches how
    // WhatsApp templates address body placeholders (`{{1}}`, `{{2}}`, ...).
    const { language, ...bodyParams } = input.params;
    const parameterValues = Object.values(bodyParams);

    const template: Record<string, unknown> = {
      name: input.templateName,
      language: { code: language ?? 'en' },
    };
    if (parameterValues.length > 0) {
      template.components = [
        {
          type: 'body',
          parameters: parameterValues.map((text) => ({ type: 'text', text })),
        },
      ];
    }

    return this.postMessage(
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: input.to,
        type: 'template',
        template,
      },
      input.to,
    );
  }

  /**
   * Cheapest real authenticated call 360dialog's docs document: fetching the connected WABA's own
   * business profile. Requests only the `about` field to keep the call minimal — this exists
   * purely to prove the stored API key is live, not to actually read profile data.
   */
  async testConnection(): Promise<{ ok: boolean; message?: string }> {
    try {
      const response = await fetch(
        `${THREE_SIXTY_DIALOG_BASE_URL}/whatsapp_business_profile?fields=about`,
        { headers: { 'D360-API-KEY': this.apiKey } },
      );
      if (!response.ok) {
        return {
          ok: false,
          message: `360dialog responded with status ${response.status}`,
        };
      }
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async postMessage(
    body: Record<string, unknown>,
    to: string,
  ): Promise<MessagingSendResult> {
    let response: Response;
    try {
      response = await fetch(`${THREE_SIXTY_DIALOG_BASE_URL}/messages`, {
        method: 'POST',
        headers: {
          'D360-API-KEY': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      this.logger.error(
        `Network error sending a 360dialog message to ${to}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { providerReference: '', status: 'failed' };
    }

    if (!response.ok) {
      this.logger.error(
        `360dialog responded with status ${response.status} for a message to ${to}`,
      );
      return { providerReference: '', status: 'failed' };
    }

    let data: ThreeSixtyDialogMessagesResponse;
    try {
      data = (await response.json()) as ThreeSixtyDialogMessagesResponse;
    } catch {
      this.logger.error(
        `360dialog returned a non-JSON response for a message to ${to}`,
      );
      return { providerReference: '', status: 'failed' };
    }

    const providerReference = data.messages?.[0]?.id;
    if (!providerReference) {
      this.logger.error(
        `360dialog returned an unexpected response shape (no messages[0].id) for a message to ${to}`,
      );
      return { providerReference: '', status: 'failed' };
    }

    return { providerReference, status: 'sent' };
  }
}
