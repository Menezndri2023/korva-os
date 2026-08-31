/**
 * Best-effort extraction of business branding (name/tagline/logo) from an arbitrary website's
 * HTML — backs onboarding's "importer mon entreprise depuis mon site existant" step. Plain
 * regex-based, deliberately not a full HTML/DOM parser: the only thing ever read is a handful
 * of well-known `<head>` tags (`<title>`, a few `<meta>` variants, a favicon `<link>`), and
 * pulling in a real DOM library for that would be a disproportionate new dependency for a
 * preview the user reviews and can freely overwrite before anything is saved — same "smallest
 * honest version" principle this codebase already applied to the ICS calendar import (one-way
 * feed instead of full OAuth) and the pdf-lib choice over @react-pdf/renderer.
 */

const MAX_HTML_LENGTH = 300_000;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Minimal HTML entity decode — good enough for the short title/description strings this
 *  extracts; not a general-purpose decoder. */
function decodeEntities(value: string): string {
  return value.replace(
    /&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g,
    (match, code: string) => {
      if (code[0] === '#') {
        const codePoint =
          code[1] === 'x' || code[1] === 'X'
            ? parseInt(code.slice(2), 16)
            : parseInt(code.slice(1), 10);
        return Number.isFinite(codePoint)
          ? String.fromCodePoint(codePoint)
          : match;
      }
      return NAMED_ENTITIES[code] ?? match;
    },
  );
}

function getAttr(tag: string, attr: string): string | undefined {
  const match = new RegExp(`${attr}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag);
  return match?.[1] !== undefined ? decodeEntities(match[1].trim()) : undefined;
}

function findMetaContent(
  html: string,
  key: 'property' | 'name',
  value: string,
): string | undefined {
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of metaTags) {
    if (getAttr(tag, key)?.toLowerCase() === value) {
      const content = getAttr(tag, 'content');
      if (content) return content;
    }
  }
  return undefined;
}

function findTitle(html: string): string | undefined {
  const match = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  const text = match?.[1] ? decodeEntities(match[1].trim()) : undefined;
  return text || undefined;
}

function findFaviconHref(html: string): string | undefined {
  const linkTags = html.match(/<link\b[^>]*>/gi) ?? [];
  for (const tag of linkTags) {
    const rel = getAttr(tag, 'rel')?.toLowerCase();
    if (
      rel === 'icon' ||
      rel === 'shortcut icon' ||
      rel === 'apple-touch-icon'
    ) {
      const href = getAttr(tag, 'href');
      if (href) return href;
    }
  }
  return undefined;
}

/** Resolves a possibly-relative URL against the page's own URL; returns undefined for anything
 *  that doesn't resolve to a genuine absolute http(s) URL (a data: URI, a malformed href, ...). */
function resolveUrl(
  candidate: string | undefined,
  baseUrl: string,
): string | undefined {
  if (!candidate) return undefined;
  try {
    const resolved = new URL(candidate, baseUrl);
    return resolved.protocol === 'http:' || resolved.protocol === 'https:'
      ? resolved.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

export interface ExtractedBusinessInfo {
  name?: string;
  tagline?: string;
  logo?: string;
}

export function extractBusinessInfoFromHtml(
  html: string,
  baseUrl: string,
): ExtractedBusinessInfo {
  const truncated = html.slice(0, MAX_HTML_LENGTH);

  const name = (
    findMetaContent(truncated, 'property', 'og:site_name') ??
    findMetaContent(truncated, 'property', 'og:title') ??
    findTitle(truncated)
  )?.slice(0, 200);

  const tagline = (
    findMetaContent(truncated, 'property', 'og:description') ??
    findMetaContent(truncated, 'name', 'description')
  )?.slice(0, 200);

  const logo = resolveUrl(
    findMetaContent(truncated, 'property', 'og:image') ??
      findFaviconHref(truncated),
    baseUrl,
  );

  return {
    name: name || undefined,
    tagline: tagline || undefined,
    logo,
  };
}
