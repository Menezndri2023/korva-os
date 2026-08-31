import { extractBusinessInfoFromHtml } from './business-import.util';

describe('extractBusinessInfoFromHtml', () => {
  it('prefers og:site_name, og:description, og:image when present', () => {
    const html = `<html><head>
      <title>Fallback Title</title>
      <meta name="description" content="Fallback description">
      <meta property="og:site_name" content="Acme Corp">
      <meta property="og:description" content="We sell widgets">
      <meta property="og:image" content="https://acme.example.com/logo.png">
    </head></html>`;

    expect(
      extractBusinessInfoFromHtml(html, 'https://acme.example.com'),
    ).toEqual({
      name: 'Acme Corp',
      tagline: 'We sell widgets',
      logo: 'https://acme.example.com/logo.png',
    });
  });

  it('falls back to <title>/meta description/favicon when og: tags are absent', () => {
    const html = `<html><head>
      <title>Acme — Home</title>
      <meta name="description" content="A small business">
      <link rel="icon" href="/favicon.ico">
    </head></html>`;

    expect(
      extractBusinessInfoFromHtml(html, 'https://acme.example.com'),
    ).toEqual({
      name: 'Acme — Home',
      tagline: 'A small business',
      logo: 'https://acme.example.com/favicon.ico',
    });
  });

  it('resolves a relative image URL against the page URL', () => {
    const html = `<meta property="og:image" content="/assets/logo.png">`;
    expect(
      extractBusinessInfoFromHtml(html, 'https://acme.example.com/about').logo,
    ).toBe('https://acme.example.com/assets/logo.png');
  });

  it('decodes common HTML entities in extracted text', () => {
    const html = `<title>Ben &amp; Jerry&#39;s</title>`;
    expect(
      extractBusinessInfoFromHtml(html, 'https://x.example.com').name,
    ).toBe("Ben & Jerry's");
  });

  it('ignores a non-http(s) image URL (e.g. a data: URI)', () => {
    const html = `<meta property="og:image" content="data:image/png;base64,AAAA">`;
    expect(
      extractBusinessInfoFromHtml(html, 'https://x.example.com').logo,
    ).toBeUndefined();
  });

  it('returns an empty object for HTML with nothing extractable', () => {
    expect(
      extractBusinessInfoFromHtml('<html></html>', 'https://x.example.com'),
    ).toEqual({
      name: undefined,
      tagline: undefined,
      logo: undefined,
    });
  });
});
