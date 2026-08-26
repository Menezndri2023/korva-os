import { createHmac } from 'node:crypto';
import { ThreeSixtyDialogWebhookVerifier } from './three-sixty-dialog-webhook-verifier';

function sign(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

describe('ThreeSixtyDialogWebhookVerifier', () => {
  const secret = 'platform-secret-abc';
  const bodyString = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ id: 'waba1', changes: [] }],
  });
  const rawBody = Buffer.from(bodyString, 'utf8');

  it('accepts a correctly-signed payload', () => {
    const verifier = new ThreeSixtyDialogWebhookVerifier(secret);
    const signature = sign(secret, bodyString);

    expect(
      verifier.verify(rawBody, { 'x-360dialog-signature': signature }),
    ).toBe(true);
  });

  it('rejects a payload signed with the wrong secret', () => {
    const verifier = new ThreeSixtyDialogWebhookVerifier(secret);
    const signature = sign('a-completely-different-secret', bodyString);

    expect(
      verifier.verify(rawBody, { 'x-360dialog-signature': signature }),
    ).toBe(false);
  });

  it('rejects when the body was tampered with after signing', () => {
    const verifier = new ThreeSixtyDialogWebhookVerifier(secret);
    const signature = sign(secret, bodyString);
    const tamperedBody = Buffer.from(bodyString.replace('waba1', 'waba2'));

    expect(
      verifier.verify(tamperedBody, { 'x-360dialog-signature': signature }),
    ).toBe(false);
  });

  it('rejects when the signature header is missing', () => {
    const verifier = new ThreeSixtyDialogWebhookVerifier(secret);
    expect(verifier.verify(rawBody, {})).toBe(false);
  });

  it('rejects when the signature header is malformed (non-hex)', () => {
    const verifier = new ThreeSixtyDialogWebhookVerifier(secret);
    expect(
      verifier.verify(rawBody, {
        'x-360dialog-signature': 'not-a-hex-signature!!',
      }),
    ).toBe(false);
  });

  it('fails closed when no platform secret is configured', () => {
    const verifier = new ThreeSixtyDialogWebhookVerifier('');
    const signature = sign(secret, bodyString);

    expect(
      verifier.verify(rawBody, { 'x-360dialog-signature': signature }),
    ).toBe(false);
  });

  it('handles an array-valued header (some proxies normalize headers this way)', () => {
    const verifier = new ThreeSixtyDialogWebhookVerifier(secret);
    const signature = sign(secret, bodyString);

    expect(
      verifier.verify(rawBody, { 'x-360dialog-signature': [signature] }),
    ).toBe(true);
  });
});
