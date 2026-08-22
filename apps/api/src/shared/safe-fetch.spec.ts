import { promises as dnsPromises } from 'node:dns';

jest.mock('node:dns', () => ({
  promises: { lookup: jest.fn() },
}));

// Imported after the mock so `assertSafeWebhookUrl`/`safeFetch` pick up the mocked dns module.
import {
  assertSafeWebhookUrl,
  safeFetch,
  UnsafeWebhookUrlError,
} from './safe-fetch';

const mockLookup = dnsPromises.lookup as jest.Mock;

function mockDns(map: Record<string, { address: string; family: number }[]>) {
  mockLookup.mockImplementation((hostname: string) => {
    const records = map[hostname];
    if (!records) return Promise.reject(new Error(`ENOTFOUND ${hostname}`));
    return Promise.resolve(records);
  });
}

function fakeResponse(
  status: number,
  headers: Record<string, string> = {},
): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
  } as unknown as Response;
}

describe('safe-fetch', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    mockLookup.mockReset();
    fetchMock = jest.fn();
    (global as unknown as { fetch: typeof fetch }).fetch = fetchMock;
  });

  describe('assertSafeWebhookUrl — scheme, literal hosts, literal IPs', () => {
    it('TEST 1: rejects http://127.0.0.1/ (wrong scheme, literal IP never reached)', async () => {
      await expect(
        assertSafeWebhookUrl('http://127.0.0.1/'),
      ).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
    });

    it('TEST 2: rejects https://127.0.0.1/ (loopback IPv4)', async () => {
      await expect(
        assertSafeWebhookUrl('https://127.0.0.1/'),
      ).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
    });

    it('TEST 3: rejects https://localhost/', async () => {
      await expect(
        assertSafeWebhookUrl('https://localhost/'),
      ).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
    });

    it('TEST 4: rejects https://localhost.localdomain/', async () => {
      await expect(
        assertSafeWebhookUrl('https://localhost.localdomain/'),
      ).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
    });

    it('TEST 5: rejects https://foo.localhost/', async () => {
      await expect(
        assertSafeWebhookUrl('https://foo.localhost/'),
      ).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
    });

    it('does NOT reject a hostname that merely contains "localhost" as a substring', async () => {
      mockDns({
        'evil-localhost.example.com': [{ address: '93.184.216.34', family: 4 }],
      });
      await expect(
        assertSafeWebhookUrl('https://evil-localhost.example.com/'),
      ).resolves.toBeInstanceOf(URL);
    });

    it('TEST 6: rejects https://169.254.169.254/latest/meta-data/ (cloud metadata)', async () => {
      await expect(
        assertSafeWebhookUrl('https://169.254.169.254/latest/meta-data/'),
      ).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
    });

    it('TEST 7: rejects https://10.0.0.5/ (RFC1918)', async () => {
      await expect(
        assertSafeWebhookUrl('https://10.0.0.5/'),
      ).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
    });

    it('TEST 8: rejects https://172.16.0.5/ (RFC1918)', async () => {
      await expect(
        assertSafeWebhookUrl('https://172.16.0.5/'),
      ).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
    });

    it('TEST 9: rejects https://192.168.1.5/ (RFC1918)', async () => {
      await expect(
        assertSafeWebhookUrl('https://192.168.1.5/'),
      ).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
    });

    it('TEST 10: rejects https://[::1]/ (IPv6 loopback)', async () => {
      await expect(
        assertSafeWebhookUrl('https://[::1]/'),
      ).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
    });

    it('TEST 11: rejects https://[fe80::1]/ (IPv6 link-local)', async () => {
      await expect(
        assertSafeWebhookUrl('https://[fe80::1]/'),
      ).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
    });

    it('TEST 12: rejects https://[fc00::1]/ (IPv6 unique-local)', async () => {
      await expect(
        assertSafeWebhookUrl('https://[fc00::1]/'),
      ).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
    });

    it('TEST 13: rejects https://[::ffff:127.0.0.1]/ (IPv4-mapped loopback)', async () => {
      await expect(
        assertSafeWebhookUrl('https://[::ffff:127.0.0.1]/'),
      ).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
    });

    it('TEST 14: rejects https://[::ffff:169.254.169.254]/ (IPv4-mapped metadata)', async () => {
      await expect(
        assertSafeWebhookUrl('https://[::ffff:169.254.169.254]/'),
      ).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
    });

    it('TEST 30: rejects https://0.0.0.0/ ("this network" / current-host address)', async () => {
      await expect(
        assertSafeWebhookUrl('https://0.0.0.0/'),
      ).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
    });

    it('TEST 31: rejects https://[::ffff:0.0.0.0]/ (IPv4-mapped 0.0.0.0)', async () => {
      await expect(
        assertSafeWebhookUrl('https://[::ffff:0.0.0.0]/'),
      ).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
    });

    it('TEST 15: rejects ftp://example.com/', async () => {
      await expect(
        assertSafeWebhookUrl('ftp://example.com/'),
      ).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
    });

    it('TEST 16: rejects http://example.com/', async () => {
      await expect(
        assertSafeWebhookUrl('http://example.com/'),
      ).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
    });

    it('TEST 17: rejects file:///etc/passwd', async () => {
      await expect(
        assertSafeWebhookUrl('file:///etc/passwd'),
      ).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
    });

    it('TEST 18: rejects gopher://example.com/', async () => {
      await expect(
        assertSafeWebhookUrl('gopher://example.com/'),
      ).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
    });

    it('TEST 28: rejects a malformed URL', async () => {
      await expect(
        assertSafeWebhookUrl('not a valid url'),
      ).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
    });
  });

  describe('assertSafeWebhookUrl — DNS resolution', () => {
    it('TEST 19: accepts a public hostname resolving to a public IP', async () => {
      mockDns({ 'example.com': [{ address: '93.184.216.34', family: 4 }] });
      await expect(
        assertSafeWebhookUrl('https://example.com/webhook'),
      ).resolves.toBeInstanceOf(URL);
    });

    it('TEST 20: rejects a hostname that resolves to a private IP', async () => {
      mockDns({ 'internal.example.com': [{ address: '10.0.0.5', family: 4 }] });
      await expect(
        assertSafeWebhookUrl('https://internal.example.com/'),
      ).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
    });

    it('TEST 21: rejects when only one of several resolved addresses is private', async () => {
      mockDns({
        'internal.example.com': [
          { address: '10.0.0.5', family: 4 },
          { address: '93.184.216.34', family: 4 },
        ],
      });
      await expect(
        assertSafeWebhookUrl('https://internal.example.com/'),
      ).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
    });
  });

  describe('safeFetch — redirect handling', () => {
    it('TEST 22: rejects a redirect to a private/metadata IP', async () => {
      mockDns({
        'public.example.com': [{ address: '93.184.216.34', family: 4 }],
      });
      fetchMock.mockResolvedValueOnce(
        fakeResponse(302, {
          location: 'https://169.254.169.254/latest/meta-data/',
        }),
      );

      await expect(
        safeFetch('https://public.example.com/webhook', { method: 'POST' }),
      ).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('TEST 23: rejects a redirect to localhost', async () => {
      mockDns({
        'public.example.com': [{ address: '93.184.216.34', family: 4 }],
      });
      fetchMock.mockResolvedValueOnce(
        fakeResponse(302, { location: 'https://localhost/' }),
      );

      await expect(
        safeFetch('https://public.example.com/webhook'),
      ).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('TEST 24: follows a legitimate public-to-public redirect', async () => {
      mockDns({
        'public.example.com': [{ address: '93.184.216.34', family: 4 }],
        'another-public.example.com': [{ address: '93.184.216.35', family: 4 }],
      });
      fetchMock
        .mockResolvedValueOnce(
          fakeResponse(302, {
            location: 'https://another-public.example.com/webhook',
          }),
        )
        .mockResolvedValueOnce(fakeResponse(200));

      const response = await safeFetch('https://public.example.com/webhook');
      expect(response.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('TEST 25: rejects a redirect chain longer than 3 hops', async () => {
      mockDns({
        'hop0.example.com': [{ address: '93.184.216.1', family: 4 }],
        'hop1.example.com': [{ address: '93.184.216.2', family: 4 }],
        'hop2.example.com': [{ address: '93.184.216.3', family: 4 }],
        'hop3.example.com': [{ address: '93.184.216.4', family: 4 }],
      });
      fetchMock
        .mockResolvedValueOnce(
          fakeResponse(302, { location: 'https://hop1.example.com/' }),
        )
        .mockResolvedValueOnce(
          fakeResponse(302, { location: 'https://hop2.example.com/' }),
        )
        .mockResolvedValueOnce(
          fakeResponse(302, { location: 'https://hop3.example.com/' }),
        )
        .mockResolvedValueOnce(
          fakeResponse(302, { location: 'https://hop4.example.com/' }),
        );

      await expect(
        safeFetch('https://hop0.example.com/'),
      ).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
      // 1 initial + 3 allowed redirect hops = 4 requests; the 4th response being another
      // redirect is what trips the "too many redirects" rejection, without a 5th request.
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it('TEST 26: resolves a relative redirect against the current URL and revalidates it', async () => {
      mockDns({
        'public.example.com': [{ address: '93.184.216.34', family: 4 }],
      });
      fetchMock
        .mockResolvedValueOnce(fakeResponse(302, { location: '/next' }))
        .mockResolvedValueOnce(fakeResponse(200));

      const response = await safeFetch('https://public.example.com/webhook');
      expect(response.status).toBe(200);
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ href: 'https://public.example.com/next' }),
        expect.anything(),
      );
    });

    it('TEST 27: rejects a redirect that downgrades to http', async () => {
      mockDns({
        'public.example.com': [{ address: '93.184.216.34', family: 4 }],
      });
      fetchMock.mockResolvedValueOnce(
        fakeResponse(302, { location: 'http://example.com/' }),
      );

      await expect(
        safeFetch('https://public.example.com/webhook'),
      ).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
    });
  });

  describe('safeFetch — timeout wiring', () => {
    it('TEST 29: propagates an abort/timeout instead of hanging', async () => {
      mockDns({
        'public.example.com': [{ address: '93.184.216.34', family: 4 }],
      });
      fetchMock.mockImplementation((_url, init: { signal?: AbortSignal }) => {
        expect(init.signal).toBeInstanceOf(AbortSignal);
        return Promise.reject(
          new DOMException('The operation was aborted.', 'AbortError'),
        );
      });

      await expect(
        safeFetch('https://public.example.com/webhook'),
      ).rejects.toThrow(/aborted/i);
    });
  });
});
