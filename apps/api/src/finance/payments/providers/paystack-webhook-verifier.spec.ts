import { createHmac } from 'node:crypto';
import { PaystackWebhookVerifier } from './paystack-webhook-verifier';

describe('PaystackWebhookVerifier', () => {
  const secretKey = 'sk_test-a-very-secret-key';

  function sign(body: string): string {
    return createHmac('sha512', secretKey).update(body).digest('hex');
  }

  it('TEST — valid signature: verify() returns true when x-paystack-signature matches the real HMAC-SHA512 of the body', () => {
    const verifier = new PaystackWebhookVerifier(secretKey);
    const body = '{"event":"charge.success"}';

    const result = verifier.verify(Buffer.from(body), {
      'x-paystack-signature': sign(body),
    });

    expect(result).toBe(true);
  });

  it('TEST — invalid signature: verify() returns false when x-paystack-signature does not match', () => {
    const verifier = new PaystackWebhookVerifier(secretKey);

    const result = verifier.verify(Buffer.from('{}'), {
      'x-paystack-signature': 'wrong-signature-entirely',
    });

    expect(result).toBe(false);
  });

  it("TEST — tampered body: verify() returns false, since this IS a genuine body-derived HMAC (unlike Flutterwave v3's static header)", () => {
    const verifier = new PaystackWebhookVerifier(secretKey);
    const originalBody = '{"event":"charge.success","amount":100}';
    const tamperedBody = '{"event":"charge.success","amount":999999}';

    const signatureOfOriginal = sign(originalBody);

    expect(
      verifier.verify(Buffer.from(originalBody), {
        'x-paystack-signature': signatureOfOriginal,
      }),
    ).toBe(true);
    expect(
      verifier.verify(Buffer.from(tamperedBody), {
        'x-paystack-signature': signatureOfOriginal,
      }),
    ).toBe(false);
  });

  it('TEST — wrong secret key: verify() returns false even against a correctly-shaped signature', () => {
    const body = '{"event":"charge.success"}';
    const signedWithDifferentKey = createHmac('sha512', 'sk_a-different-key')
      .update(body)
      .digest('hex');

    const verifier = new PaystackWebhookVerifier(secretKey);
    expect(
      verifier.verify(Buffer.from(body), {
        'x-paystack-signature': signedWithDifferentKey,
      }),
    ).toBe(false);
  });

  it('TEST — missing x-paystack-signature header: returns false', () => {
    const verifier = new PaystackWebhookVerifier(secretKey);

    expect(verifier.verify(Buffer.from('{}'), {})).toBe(false);
  });

  it('TEST — x-paystack-signature header present as an array: uses the first value', () => {
    const body = '{}';
    const verifier = new PaystackWebhookVerifier(secretKey);

    expect(
      verifier.verify(Buffer.from(body), {
        'x-paystack-signature': [sign(body), 'something-else'],
      }),
    ).toBe(true);
  });

  it('TEST — empty configured secret key: fails closed (returns false) rather than matching an empty header', () => {
    const verifier = new PaystackWebhookVerifier('');

    expect(
      verifier.verify(Buffer.from('{}'), { 'x-paystack-signature': '' }),
    ).toBe(false);
  });

  it('TEST — different-length header value: returns false without throwing', () => {
    const verifier = new PaystackWebhookVerifier(secretKey);

    expect(() =>
      verifier.verify(Buffer.from('{}'), { 'x-paystack-signature': 'short' }),
    ).not.toThrow();
    expect(
      verifier.verify(Buffer.from('{}'), { 'x-paystack-signature': 'short' }),
    ).toBe(false);
  });

  it('exposes provider = "paystack"', () => {
    expect(new PaystackWebhookVerifier(secretKey).provider).toBe('paystack');
  });
});
