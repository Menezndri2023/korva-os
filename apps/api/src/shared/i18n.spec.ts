import { intlLocaleOf, orgLocale, translator } from './i18n';

describe('shared/i18n', () => {
  it('writes in English only for an English business', () => {
    expect(translator('en')('Bonjour', 'Hello')).toBe('Hello');
    expect(translator('en-GB')('Bonjour', 'Hello')).toBe('Hello');
    expect(translator('fr')('Bonjour', 'Hello')).toBe('Bonjour');
  });

  it('falls back to French for a missing or unknown language', () => {
    expect(orgLocale(undefined)).toBe('fr');
    expect(orgLocale('de')).toBe('fr');
    expect(intlLocaleOf(null)).toBe('fr-FR');
    expect(intlLocaleOf('en')).toBe('en-GB');
  });
});
