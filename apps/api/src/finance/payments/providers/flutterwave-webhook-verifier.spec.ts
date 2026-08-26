import { FlutterwaveWebhookVerifier } from './flutterwave-webhook-verifier';

describe('FlutterwaveWebhookVerifier', () => {
  const secretHash = 'a-very-secret-hash-value';

  it('TEST — valid signature: verify() returns true when verif-hash matches exactly', () => {
    const verifier = new FlutterwaveWebhookVerifier(secretHash);

    const result = verifier.verify(
      Buffer.from('{"event":"charge.completed"}'),
      {
        'verif-hash': secretHash,
      },
    );

    expect(result).toBe(true);
  });

  it('TEST — invalid signature: verify() returns false when verif-hash does not match', () => {
    const verifier = new FlutterwaveWebhookVerifier(secretHash);

    const result = verifier.verify(Buffer.from('{}'), {
      'verif-hash': 'wrong-hash-entirely',
    });

    expect(result).toBe(false);
  });

  it('TEST — tampered body: verify() still returns true, since v3 authenticates via a static shared secret header, not a body-derived HMAC (documented, not a bug)', () => {
    const verifier = new FlutterwaveWebhookVerifier(secretHash);

    const originalBody = Buffer.from(
      '{"event":"charge.completed","amount":100}',
    );
    const tamperedBody = Buffer.from(
      '{"event":"charge.completed","amount":999999}',
    );

    expect(verifier.verify(originalBody, { 'verif-hash': secretHash })).toBe(
      true,
    );
    expect(verifier.verify(tamperedBody, { 'verif-hash': secretHash })).toBe(
      true,
    );
  });

  it('TEST — missing verif-hash header: returns false', () => {
    const verifier = new FlutterwaveWebhookVerifier(secretHash);

    expect(verifier.verify(Buffer.from('{}'), {})).toBe(false);
  });

  it('TEST — verif-hash header present as an array: uses the first value', () => {
    const verifier = new FlutterwaveWebhookVerifier(secretHash);

    expect(
      verifier.verify(Buffer.from('{}'), {
        'verif-hash': [secretHash, 'something-else'],
      }),
    ).toBe(true);
  });

  it('TEST — empty configured secret hash: fails closed (returns false) rather than matching an empty header', () => {
    const verifier = new FlutterwaveWebhookVerifier('');

    expect(verifier.verify(Buffer.from('{}'), { 'verif-hash': '' })).toBe(
      false,
    );
  });

  it('TEST — different-length header value: returns false without throwing', () => {
    const verifier = new FlutterwaveWebhookVerifier(secretHash);

    expect(() =>
      verifier.verify(Buffer.from('{}'), { 'verif-hash': 'short' }),
    ).not.toThrow();
    expect(verifier.verify(Buffer.from('{}'), { 'verif-hash': 'short' })).toBe(
      false,
    );
  });

  it('exposes provider = "flutterwave"', () => {
    expect(new FlutterwaveWebhookVerifier(secretHash).provider).toBe(
      'flutterwave',
    );
  });
});
