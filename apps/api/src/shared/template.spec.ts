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

  describe('escapeHtml option', () => {
    it('HTML-escapes a substituted value when escapeHtml is true, leaving the template markup intact', () => {
      expect(
        interpolate(
          '<p>Hi {{name}}</p>',
          { name: '<script>alert(1)</script>' },
          { escapeHtml: true },
        ),
      ).toBe('<p>Hi &lt;script&gt;alert(1)&lt;/script&gt;</p>');
    });

    it('does not escape the substituted value when escapeHtml is omitted (historical behavior)', () => {
      expect(
        interpolate('<p>Hi {{name}}</p>', {
          name: '<script>alert(1)</script>',
        }),
      ).toBe('<p>Hi <script>alert(1)</script></p>');
    });

    it('does not escape the substituted value when escapeHtml is explicitly false', () => {
      expect(
        interpolate(
          '<p>Hi {{name}}</p>',
          { name: '<script>alert(1)</script>' },
          { escapeHtml: false },
        ),
      ).toBe('<p>Hi <script>alert(1)</script></p>');
    });

    it('escapes &, <, >, ", and \' individually', () => {
      expect(
        interpolate('{{value}}', { value: `& < > " '` }, { escapeHtml: true }),
      ).toBe('&amp; &lt; &gt; &quot; &#39;');
    });

    it('produces no visible artifact for a plain value with no special characters', () => {
      expect(
        interpolate('Bonjour {{name}}', { name: 'Jean' }, { escapeHtml: true }),
      ).toBe('Bonjour Jean');
    });
  });
});
