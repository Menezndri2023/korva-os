import { slugify } from './organizations.service';

describe('slugify', () => {
  it('lowercases and dasherizes a simple name', () => {
    expect(slugify('Org Alpha')).toBe('org-alpha');
  });

  it('strips accents/diacritics', () => {
    expect(slugify('Café Déjà-vu')).toBe('cafe-deja-vu');
  });

  it('collapses non-alphanumeric runs into a single dash', () => {
    expect(slugify('  Multi   ---  Space!!  ')).toBe('multi-space');
  });

  it('trims leading and trailing dashes', () => {
    expect(slugify('--Edge--')).toBe('edge');
  });

  it('returns an empty string for input with no alphanumeric characters', () => {
    expect(slugify('!!!')).toBe('');
  });
});
