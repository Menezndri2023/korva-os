import { clientErrorSchema } from './client-errors.controller';

describe('clientErrorSchema', () => {
  it('keeps only the path: the tracking page carries an e-mail in its query string', () => {
    expect(
      clientErrorSchema.parse({
        app: 'storefront',
        message: 'boom',
        path: '/boutique/track?kind=order&email=fatou@example.com#top',
      }).path,
    ).toBe('/boutique/track');
  });
});
