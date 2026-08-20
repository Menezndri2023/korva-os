import { interpolate } from './template';

describe('interpolate', () => {
  it('replaces a top-level placeholder', () => {
    expect(interpolate('Hello {{name}}', { name: 'Ada' })).toBe('Hello Ada');
  });

  it('resolves a dot-path placeholder into a nested object', () => {
    expect(
      interpolate('{{contact.firstName}}', { contact: { firstName: 'Ada' } }),
    ).toBe('Ada');
  });

  it('replaces an unresolved placeholder with an empty string', () => {
    expect(interpolate('Hello {{missing}}', {})).toBe('Hello ');
  });

  it('stringifies numbers and booleans', () => {
    expect(
      interpolate('{{amount}} / {{active}}', { amount: 42, active: true }),
    ).toBe('42 / true');
  });

  it('JSON-stringifies object and array values', () => {
    expect(interpolate('{{tags}}', { tags: ['a', 'b'] })).toBe('["a","b"]');
  });

  it('tolerates surrounding whitespace inside the braces', () => {
    expect(interpolate('{{  name  }}', { name: 'Ada' })).toBe('Ada');
  });

  it('leaves the string untouched when there are no placeholders', () => {
    expect(interpolate('No placeholders here', { name: 'Ada' })).toBe(
      'No placeholders here',
    );
  });
});
