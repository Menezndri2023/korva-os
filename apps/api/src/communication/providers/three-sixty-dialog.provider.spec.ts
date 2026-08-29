import { ThreeSixtyDialogProvider } from './three-sixty-dialog.provider';

interface FakeFetchResponse {
  ok: boolean;
  status: number;
  json?: () => Promise<unknown>;
}

type FakeFetch = jest.Mock<Promise<FakeFetchResponse>, [string, RequestInit]>;

function parseBody(init: RequestInit): Record<string, unknown> {
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

function headerValue(init: RequestInit, name: string): string | undefined {
  return (init.headers as Record<string, string>)[name];
}

describe('ThreeSixtyDialogProvider', () => {
  let provider: ThreeSixtyDialogProvider;
  let fetchMock: FakeFetch;

  beforeEach(() => {
    provider = new ThreeSixtyDialogProvider('test-api-key');
    fetchMock = jest.fn<Promise<FakeFetchResponse>, [string, RequestInit]>();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // Stage 2.4: independent, constructor-level fail-closed guard, mirroring FlutterwaveProvider's
  // own (Stage 2.2) — must hold even if a future caller bypasses MessagingProviderRegistry's own
  // requireSecret() check and constructs this class directly.
  describe('constructor — fail-closed on a missing API key', () => {
    it('throws when constructed with an empty string', () => {
      expect(() => new ThreeSixtyDialogProvider('')).toThrow();
    });

    it('never leaves fetch reachable with an empty D360-API-KEY header', () => {
      expect(() => new ThreeSixtyDialogProvider('')).toThrow();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('send', () => {
    it('posts a text message to 360dialog and returns the provider reference on success', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            messaging_product: 'whatsapp',
            contacts: [{ input: '+2250700000000', wa_id: '2250700000000' }],
            messages: [{ id: 'wamid.ABC123', message_status: 'accepted' }],
          }),
      });

      const result = await provider.send({
        to: '+2250700000000',
        body: 'Hello there',
      });

      expect(result).toEqual({
        providerReference: 'wamid.ABC123',
        status: 'sent',
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe('https://waba-v2.360dialog.io/messages');
      expect(init.method).toBe('POST');
      expect(headerValue(init, 'D360-API-KEY')).toBe('test-api-key');
      expect(parseBody(init)).toEqual({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: '+2250700000000',
        type: 'text',
        text: { body: 'Hello there', preview_url: false },
      });
    });

    it('returns a failed result and does not throw on a non-2xx response', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500 });

      const result = await provider.send({ to: '+225070', body: 'x' });

      expect(result).toEqual({ providerReference: '', status: 'failed' });
    });

    it('returns a failed result on a malformed (missing messages[0].id) success response', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ messaging_product: 'whatsapp' }),
      });

      const result = await provider.send({ to: '+225070', body: 'x' });

      expect(result).toEqual({ providerReference: '', status: 'failed' });
    });

    it('returns a failed result on a non-JSON success response', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError('Unexpected token')),
      });

      const result = await provider.send({ to: '+225070', body: 'x' });

      expect(result).toEqual({ providerReference: '', status: 'failed' });
    });

    it('returns a failed result on a network failure and never calls the real network', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await provider.send({ to: '+225070', body: 'x' });

      expect(result).toEqual({ providerReference: '', status: 'failed' });
    });
  });

  describe('sendTemplate', () => {
    it('posts a template message with positional body params and returns success', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ messages: [{ id: 'wamid.TPL1' }] }),
      });

      const result = await provider.sendTemplate({
        to: '+225070',
        templateName: 'booking_confirmation',
        params: { '1': 'Alice', '2': 'Tomorrow 3pm' },
        category: 'utility',
      });

      expect(result).toEqual({
        providerReference: 'wamid.TPL1',
        status: 'sent',
      });
      const init = fetchMock.mock.calls[0]![1];
      const body = parseBody(init);
      expect(body.type).toBe('template');
      expect(body.template).toEqual({
        name: 'booking_confirmation',
        language: { code: 'en' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'Alice' },
              { type: 'text', text: 'Tomorrow 3pm' },
            ],
          },
        ],
      });
      // category is a template-creation-time attribute, never sent per-message
      expect(body.category).toBeUndefined();
    });

    it('respects an explicit params.language override and omits components when there are no other params', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ messages: [{ id: 'wamid.TPL2' }] }),
      });

      await provider.sendTemplate({
        to: '+225070',
        templateName: 'otp_code',
        params: { language: 'fr' },
        category: 'authentication',
      });

      const init = fetchMock.mock.calls[0]![1];
      const body = parseBody(init);
      const template = body.template as { language: { code: string } };
      expect(template.language).toEqual({ code: 'fr' });
      expect(
        (body.template as Record<string, unknown>).components,
      ).toBeUndefined();
    });

    it('returns a failed result on a non-2xx response', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 400 });

      const result = await provider.sendTemplate({
        to: '+225070',
        templateName: 'x',
        params: {},
        category: 'marketing',
      });

      expect(result).toEqual({ providerReference: '', status: 'failed' });
    });

    it('returns a failed result on network failure', async () => {
      fetchMock.mockRejectedValue(new Error('timeout'));

      const result = await provider.sendTemplate({
        to: '+225070',
        templateName: 'x',
        params: {},
        category: 'marketing',
      });

      expect(result).toEqual({ providerReference: '', status: 'failed' });
    });
  });

  describe('testConnection', () => {
    it('returns ok:true on a successful authenticated business-profile fetch', async () => {
      fetchMock.mockResolvedValue({ ok: true, status: 200 });

      const result = await provider.testConnection();

      expect(result).toEqual({ ok: true });
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(url).toBe(
        'https://waba-v2.360dialog.io/whatsapp_business_profile?fields=about',
      );
      expect(headerValue(init, 'D360-API-KEY')).toBe('test-api-key');
    });

    it('returns ok:false with a message on a non-2xx response (e.g. bad API key)', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 401 });

      const result = await provider.testConnection();

      expect(result.ok).toBe(false);
      expect(result.message).toContain('401');
    });

    it('returns ok:false on a network failure', async () => {
      fetchMock.mockRejectedValue(new Error('DNS lookup failed'));

      const result = await provider.testConnection();

      expect(result.ok).toBe(false);
      expect(result.message).toContain('DNS lookup failed');
    });
  });
});
