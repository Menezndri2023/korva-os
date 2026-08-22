import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';

/**
 * Thrown whenever a webhook URL (or a redirect target it leads to) is rejected. The message is
 * intentionally generic — never include the resolved IP, DNS details, or other infrastructure
 * information, since this error can surface to the org member who configured the webhook.
 */
export class UnsafeWebhookUrlError extends Error {}

const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 5000;

interface CidrRange {
  network: string;
  prefixLength: number;
}

/** IPv4 ranges from RFC 1918/5737/6598/etc — private, loopback, link-local, shared, documentation, multicast, reserved. */
const BLOCKED_IPV4_RANGES: CidrRange[] = [
  { network: '0.0.0.0', prefixLength: 8 },
  { network: '10.0.0.0', prefixLength: 8 },
  { network: '100.64.0.0', prefixLength: 10 },
  { network: '127.0.0.0', prefixLength: 8 },
  { network: '169.254.0.0', prefixLength: 16 },
  { network: '172.16.0.0', prefixLength: 12 },
  { network: '192.0.0.0', prefixLength: 24 },
  { network: '192.0.2.0', prefixLength: 24 },
  { network: '192.168.0.0', prefixLength: 16 },
  { network: '198.18.0.0', prefixLength: 15 },
  { network: '198.51.100.0', prefixLength: 24 },
  { network: '203.0.113.0', prefixLength: 24 },
  { network: '224.0.0.0', prefixLength: 4 },
  { network: '240.0.0.0', prefixLength: 4 },
];

/** IPv6 ranges — loopback, unspecified, unique-local, link-local, multicast. */
const BLOCKED_IPV6_RANGES: CidrRange[] = [
  { network: '::1', prefixLength: 128 },
  { network: '::', prefixLength: 128 },
  { network: 'fc00::', prefixLength: 7 },
  { network: 'fe80::', prefixLength: 10 },
  { network: 'ff00::', prefixLength: 8 },
];

function ipv4ToInt(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const byte = Number(part);
    if (byte > 255) return null;
    result = (result << 8) | byte;
  }
  return result >>> 0;
}

function isIPv4InRange(address: string, range: CidrRange): boolean {
  const ip = ipv4ToInt(address);
  const rangeStart = ipv4ToInt(range.network);
  if (ip === null || rangeStart === null) return false;
  const mask =
    range.prefixLength === 0
      ? 0
      : (0xffffffff << (32 - range.prefixLength)) >>> 0;
  return (ip & mask) === (rangeStart & mask);
}

function isBlockedIPv4(address: string): boolean {
  return BLOCKED_IPV4_RANGES.some((range) => isIPv4InRange(address, range));
}

/** Expands any valid textual IPv6 address (incl. "::" compression and embedded IPv4) into 16 bytes. */
function parseIPv6ToBytes(address: string): Buffer | null {
  const zoneIndex = address.indexOf('%');
  const addr = zoneIndex === -1 ? address : address.slice(0, zoneIndex);

  const doubleColonParts = addr.split('::');
  if (doubleColonParts.length > 2) return null;

  const expandEmbeddedIPv4 = (groups: string[]): string[] | null => {
    if (groups.length === 0) return groups;
    const last = groups[groups.length - 1] as string;
    if (!last.includes('.')) return groups;
    const ipv4Int = ipv4ToInt(last);
    if (ipv4Int === null) return null;
    const hi = ((ipv4Int >>> 16) & 0xffff).toString(16);
    const lo = (ipv4Int & 0xffff).toString(16);
    return [...groups.slice(0, -1), hi, lo];
  };

  const parseGroups = (part: string): string[] =>
    part.length === 0 ? [] : part.split(':');

  let head = parseGroups(doubleColonParts[0] ?? '');
  let tail =
    doubleColonParts.length === 2 ? parseGroups(doubleColonParts[1] ?? '') : [];

  const expandedHead = expandEmbeddedIPv4(head);
  const expandedTail = expandEmbeddedIPv4(tail);
  if (expandedHead === null || expandedTail === null) return null;
  head = expandedHead;
  tail = expandedTail;

  const totalGroups = head.length + tail.length;
  if (doubleColonParts.length === 1) {
    if (head.length !== 8) return null;
  } else if (totalGroups > 8) {
    return null;
  }

  const missing = doubleColonParts.length === 2 ? 8 - totalGroups : 0;
  const groups = [...head, ...Array(missing).fill('0'), ...tail];
  if (groups.length !== 8) return null;

  const buffer = Buffer.alloc(16);
  for (let i = 0; i < 8; i++) {
    const group = groups[i];
    if (group === undefined || !/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    buffer.writeUInt16BE(parseInt(group, 16), i * 2);
  }
  return buffer;
}

function isIPv6InRange(bytes: Buffer, range: CidrRange): boolean {
  const rangeBytes = parseIPv6ToBytes(range.network);
  if (!rangeBytes) return false;
  const fullBytes = Math.floor(range.prefixLength / 8);
  for (let i = 0; i < fullBytes; i++) {
    if (bytes[i] !== rangeBytes[i]) return false;
  }
  const remainingBits = range.prefixLength % 8;
  if (remainingBits > 0) {
    const mask = 0xff << (8 - remainingBits);
    if (
      ((bytes[fullBytes] as number) & mask) !==
      ((rangeBytes[fullBytes] as number) & mask)
    ) {
      return false;
    }
  }
  return true;
}

/** If `bytes` is an IPv4-mapped IPv6 address (::ffff:a.b.c.d), returns the embedded IPv4 in dotted form. */
function extractMappedIPv4(bytes: Buffer): string | null {
  for (let i = 0; i < 10; i++) {
    if (bytes[i] !== 0) return null;
  }
  if (bytes[10] !== 0xff || bytes[11] !== 0xff) return null;
  return `${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`;
}

function isBlockedIPv6(address: string): boolean {
  const bytes = parseIPv6ToBytes(address);
  if (!bytes) return true; // unparseable — fail closed

  const mappedIPv4 = extractMappedIPv4(bytes);
  if (mappedIPv4) return isBlockedIPv4(mappedIPv4);

  return BLOCKED_IPV6_RANGES.some((range) => isIPv6InRange(bytes, range));
}

function isBlockedLiteralHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (h === 'localhost' || h === 'localhost.localdomain') return true;
  if (h.endsWith('.localhost') || h.endsWith('.local')) return true;
  return false;
}

/** Strips the [ ] wrapper the WHATWG URL parser puts around a literal IPv6 hostname. */
function unwrapIPv6Hostname(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
}

async function assertHostResolvesToPublicAddress(
  hostname: string,
): Promise<void> {
  const literalFamily = isIP(hostname);
  if (literalFamily === 4) {
    if (isBlockedIPv4(hostname)) {
      throw new UnsafeWebhookUrlError(
        'Webhook URL resolves to a disallowed address',
      );
    }
    return;
  }
  if (literalFamily === 6) {
    if (isBlockedIPv6(hostname)) {
      throw new UnsafeWebhookUrlError(
        'Webhook URL resolves to a disallowed address',
      );
    }
    return;
  }

  // Not a literal IP — resolve every A/AAAA record and reject if any single one is
  // private/reserved. Re-run for every hop (see assertSafeWebhookUrl callers) so a hostname
  // that starts public but is later repointed can't slip a private address in later — this
  // does not fully close DNS-rebinding between this check and the fetch() call right after it
  // (Node's fetch does its own resolution), only pinning the connection to the address we
  // just validated would close that gap, which is out of scope for this fix.
  let records: { address: string; family: number }[];
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new UnsafeWebhookUrlError('Unable to resolve webhook host');
  }
  if (records.length === 0) {
    throw new UnsafeWebhookUrlError('Unable to resolve webhook host');
  }
  for (const record of records) {
    const blocked =
      record.family === 4
        ? isBlockedIPv4(record.address)
        : isBlockedIPv6(record.address);
    if (blocked) {
      throw new UnsafeWebhookUrlError(
        'Webhook URL resolves to a disallowed address',
      );
    }
  }
}

/**
 * Validates a webhook URL: https-only, no localhost/.local hostnames, and every DNS record the
 * hostname resolves to (IPv4 and IPv6, including IPv4-mapped IPv6) must be a public, routable
 * address. Throws UnsafeWebhookUrlError and never resolves an unsafe URL. Must be re-run on
 * every redirect hop — see safeFetch.
 */
export async function assertSafeWebhookUrl(url: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UnsafeWebhookUrlError('Invalid webhook URL');
  }

  if (parsed.protocol !== 'https:') {
    throw new UnsafeWebhookUrlError('Webhook URL must use https');
  }

  const hostname = unwrapIPv6Hostname(parsed.hostname);
  if (!hostname) {
    throw new UnsafeWebhookUrlError('Webhook URL must include a hostname');
  }
  if (isBlockedLiteralHostname(hostname)) {
    throw new UnsafeWebhookUrlError('Webhook URL targets a disallowed host');
  }

  await assertHostResolvesToPublicAddress(hostname);
  return parsed;
}

export interface SafeFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

/**
 * A fetch() replacement for user-supplied webhook URLs: validates the URL (and every redirect
 * target) against assertSafeWebhookUrl before each request, never follows a redirect
 * automatically, caps the redirect chain at MAX_REDIRECTS, and applies a request timeout.
 */
export async function safeFetch(
  initialUrl: string,
  init: SafeFetchInit = {},
): Promise<Response> {
  let currentUrl = initialUrl;
  let redirectCount = 0;

  while (true) {
    const validated = await assertSafeWebhookUrl(currentUrl);

    const response = await fetch(validated, {
      method: init.method,
      headers: init.headers,
      body: init.body,
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const isRedirect = response.status >= 300 && response.status < 400;
    if (!isRedirect) {
      return response;
    }

    redirectCount += 1;
    if (redirectCount > MAX_REDIRECTS) {
      throw new UnsafeWebhookUrlError('Too many webhook redirects');
    }

    const location = response.headers.get('location');
    if (!location) {
      throw new UnsafeWebhookUrlError(
        'Redirect response is missing a Location header',
      );
    }

    let nextUrl: URL;
    try {
      nextUrl = new URL(location, validated);
    } catch {
      throw new UnsafeWebhookUrlError('Redirect target is an invalid URL');
    }
    currentUrl = nextUrl.toString();
  }
}
